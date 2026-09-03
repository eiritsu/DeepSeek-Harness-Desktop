import Foundation

struct SourceUpdate: Sendable {
  let sourceRoot: URL
  let commit: String
  let changed: Bool
}

enum SourceUpdateTopology: Equatable {
  case unchanged
  case fastForward
  case localAhead
  case diverged
}

final class SourceManager: @unchecked Sendable {
  private static let bootstrapVersionFile = ".dsh-desktop-bootstrap-version"
  private static let legacyMigrationMarker = ".dsh-home-migration-v2"
  private static let managedExtensionPaths = [
    // These Harness-owned packages are shipped as part of the desktop build.
    // The public update branch may advance independently, so keep the local
    // desktop integration in the staged tree until that branch carries it.
    "packages/session/session-persistence-sqlite",
    "packages/bundle/base",
    "packages/settings/settings-file",
    "packages/credentials/credentials-local",
    "packages/llm/llm",
    "packages/attachment/attachment",
    "packages/extensions/tool-cordis",
    "packages/client/ui-plugin-library",
    "packages/client/ui-skill-library",
    "packages/client/ui-deepseek-files",
    "packages/attachment/file-recognizer-office",
    "packages/lark/lark",
    "packages/llm/model-catalog",
    "apps/cli/package.json",
  ]

  private let defaults: UserDefaults
  private let queue = DispatchQueue(label: "ai.deepseek.harness.desktop.source", qos: .userInitiated)
  private let bootstrapArchive: URL?
  private let bootstrapVersion: String?
  private let sourceRepository: String
  private let sourceBranch: String
  private let legacyHome: URL?
  private let allowsExternalSourceRoot: Bool

  let supportRoot: URL
  let dshHome: URL
  let probeHome: URL

  init(
    supportRoot: URL? = nil,
    defaults: UserDefaults = .standard,
    bootstrapArchive: URL? = Bundle.main.url(forResource: "SourceBootstrap", withExtension: "tar.gz"),
    bootstrapVersion: String? = SourceManager.bootstrapIdentity(
      version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
      build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
    ),
    sourceRepository: String = Bundle.main.object(forInfoDictionaryKey: "DSHSourceRepository") as? String
      ?? "https://github.com/deepseek-ai/deepseek-harness.git",
    sourceBranch: String = Bundle.main.object(forInfoDictionaryKey: "DSHSourceBranch") as? String ?? "master",
    legacyHome: URL? = nil,
    allowsExternalSourceRoot: Bool? = nil
  ) {
    let resolvedSupportRoot = supportRoot ?? FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0].appendingPathComponent("DeepSeek Harness Desktop", isDirectory: true)
    self.defaults = defaults
    self.bootstrapArchive = bootstrapArchive
    self.bootstrapVersion = bootstrapVersion
    self.sourceRepository = sourceRepository
    self.sourceBranch = sourceBranch
    self.supportRoot = resolvedSupportRoot
    self.legacyHome = legacyHome ?? (supportRoot == nil
      ? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh", isDirectory: true)
      : nil)
    self.allowsExternalSourceRoot = allowsExternalSourceRoot
      ?? (Bundle.main.object(forInfoDictionaryKey: "DSHSourceRoot") != nil || bootstrapArchive == nil)
    dshHome = self.supportRoot.appendingPathComponent("data", isDirectory: true)
    probeHome = self.supportRoot.appendingPathComponent("probe-data", isDirectory: true)
  }

  static func bootstrapIdentity(version: String?, build: String?) -> String? {
    guard let version, !version.isEmpty, let build, !build.isEmpty else { return nil }
    return "\(version)+\(build)"
  }

  static func updateTopology(
    sameCommit: Bool,
    remoteContainsLocal: Bool,
    localContainsRemote: Bool
  ) -> SourceUpdateTopology {
    if sameCommit { return .unchanged }
    if remoteContainsLocal { return .fastForward }
    if localContainsRemote { return .localAhead }
    return .diverged
  }

  func resolveAndPrepare(
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<URL, Error>) -> Void
  ) {
    queue.async {
      do {
        try FileManager.default.createDirectory(at: self.supportRoot, withIntermediateDirectories: true)
        let dataStore = try DesktopDataStore(supportRoot: self.supportRoot)
        try dataStore.initialize(legacyHome: self.legacyHome)
        defer { dataStore.close() }
        try self.migrateLegacyHome(progress: progress)
        try dataStore.synchronizePayloads(from: self.dshHome)
        let source = try self.resolveSource(progress: progress)
        try self.prepare(source, progress: progress)
        try self.recordSourceRelease(source: source, active: true)
        completion(.success(source))
      } catch {
        completion(.failure(error))
      }
    }
  }

  /// Preserve the legacy Harness home while moving its durable data into Application Support.
  private func migrateLegacyHome(progress: @escaping @Sendable (String) -> Void) throws {
    let marker = dshHome.appendingPathComponent(Self.legacyMigrationMarker)
    guard !FileManager.default.fileExists(atPath: marker.path), let legacyHome else { return }
    let fileManager = FileManager.default
    guard legacyHome.standardizedFileURL != dshHome.standardizedFileURL else {
      try Data("skipped: same home\n".utf8).write(to: marker, options: .atomic)
      return
    }
    guard fileManager.fileExists(atPath: legacyHome.path) else {
      try fileManager.createDirectory(at: dshHome, withIntermediateDirectories: true)
      try Data("skipped: legacy home absent\n".utf8).write(to: marker, options: .atomic)
      return
    }
    progress("正在迁移现有 Harness 数据到 Application Support…\n")
    try fileManager.createDirectory(at: dshHome, withIntermediateDirectories: true)
    try mergeDirectory(from: legacyHome, into: dshHome, relativePath: "")
    try Data("migrated from ~/.dsh\n".utf8).write(to: marker, options: .atomic)
    LogStore.shared.append("migrated legacy Harness home from \(legacyHome.path)")
  }

  private func mergeDirectory(from source: URL, into destination: URL, relativePath: String) throws {
    let fileManager = FileManager.default
    for item in try fileManager.contentsOfDirectory(at: source, includingPropertiesForKeys: [.isDirectoryKey]) {
      let name = item.lastPathComponent
      let relative = relativePath.isEmpty ? name : "\(relativePath)/\(name)"
      // Profile dependency trees are install-time artifacts. Copying their
      // symlinks from ~/.dsh can target a developer checkout and can fail when
      // the managed profile already owns the package directory.
      if relative.split(separator: "/").contains(where: { $0 == "node_modules" || $0 == ".bin" }) {
        continue
      }
      let target = destination.appendingPathComponent(name)
      let isDirectory = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
      if isDirectory {
        try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
        try mergeDirectory(from: item, into: target, relativePath: relative)
      } else if !fileManager.fileExists(atPath: target.path) || Self.legacyFileWins(relativePath: relative) {
        if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
        try fileManager.copyItem(at: item, to: target)
      }
    }
    if relativePath == "profiles/web" {
      try mergeWebProfileManifest(at: source, destination: destination)
    }
  }

  private static func legacyFileWins(relativePath: String) -> Bool {
    relativePath == "settings.yaml"
      || relativePath == ".credentials.yaml"
      || relativePath == ".anonymous-user-id"
      || relativePath == "workspace.json"
      || relativePath == "storages/workspace.json"
      || relativePath == "storages/session_projcache.json"
  }

  private func mergeWebProfileManifest(at source: URL, destination: URL) throws {
    let sourceManifest = source.appendingPathComponent("package.json")
    let destinationManifest = destination.appendingPathComponent("package.json")
    guard FileManager.default.fileExists(atPath: sourceManifest.path),
          FileManager.default.fileExists(atPath: destinationManifest.path),
          let legacy = try JSONSerialization.jsonObject(with: Data(contentsOf: sourceManifest)) as? [String: Any],
          var current = try JSONSerialization.jsonObject(with: Data(contentsOf: destinationManifest)) as? [String: Any]
    else { return }
    var dependencies = (current["dependencies"] as? [String: String]) ?? [:]
    dependencies.merge((legacy["dependencies"] as? [String: String]) ?? [:]) { legacy, _ in legacy }
    current["dependencies"] = dependencies
    if let dsh = legacy["dsh"] { current["dsh"] = dsh }
    let data = try JSONSerialization.data(withJSONObject: current, options: [.prettyPrinted, .sortedKeys]) + Data("\n".utf8)
    try data.write(to: destinationManifest, options: .atomic)
  }

  private func resolveSource(progress: @escaping @Sendable (String) -> Void) throws -> URL {
    let environment = ProcessInfo.processInfo.environment
    let bootstrap = supportRoot.appendingPathComponent("source", isDirectory: true)
    if self.allowsExternalSourceRoot, let path = environment["DSH_SOURCE_DIR"] {
      let source = URL(fileURLWithPath: path, isDirectory: true)
      if isSourceRoot(source) { return source }
    }
    if self.allowsExternalSourceRoot,
       let path = Bundle.main.object(forInfoDictionaryKey: "DSHSourceRoot") as? String {
      let source = URL(fileURLWithPath: path, isDirectory: true)
      if isSourceRoot(source) { return source }
    }
    if let path = defaults.string(forKey: "activeSourceRoot") {
      let source = URL(fileURLWithPath: path, isDirectory: true)
      let isInsideSupport = source.standardizedFileURL.path.hasPrefix(
        supportRoot.standardizedFileURL.path + "/"
      )
      if source.standardizedFileURL != bootstrap.standardizedFileURL,
         isInsideSupport,
         isSourceRoot(source) {
        return source
      }
      if self.allowsExternalSourceRoot,
         !isInsideSupport,
         source.standardizedFileURL != bootstrap.standardizedFileURL,
         isSourceRoot(source) {
        return source
      }
      if source.standardizedFileURL == bootstrap.standardizedFileURL,
         isSourceRoot(source),
         !shouldInstallBootstrap(at: bootstrap) {
        return source
      }
    }
    if let archive = bootstrapArchive {
      if shouldInstallBootstrap(at: bootstrap) {
        progress("正在更新随应用提供的 DeepSeek Harness 源码…\n")
        try installBootstrap(archive, at: bootstrap, progress: progress)
      }
      defaults.set(bootstrap.path, forKey: "activeSourceRoot")
      return bootstrap
    }
    if isSourceRoot(bootstrap) { return bootstrap }
    progress("正在首次下载 DeepSeek Harness 源码…\n")
    let result = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/git"),
      arguments: ["clone", "--branch", sourceBranch, sourceRepository, bootstrap.path],
      progress: progress
    )
    guard result.status == 0, isSourceRoot(bootstrap) else {
      throw DesktopError.message("源码下载失败：\n\(result.output)")
    }
    defaults.set(bootstrap.path, forKey: "activeSourceRoot")
    return bootstrap
  }

  private func shouldInstallBootstrap(at bootstrap: URL) -> Bool {
    guard isSourceRoot(bootstrap) else { return true }
    guard let bootstrapVersion else { return false }
    let marker = bootstrap.appendingPathComponent(Self.bootstrapVersionFile)
    let installedVersion = try? String(contentsOf: marker, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return installedVersion != bootstrapVersion
  }

  private func installBootstrap(
    _ archive: URL,
    at bootstrap: URL,
    progress: @escaping @Sendable (String) -> Void
  ) throws {
    let stage = supportRoot.appendingPathComponent(".source-bootstrap-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: stage) }
    try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
    let unpack = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/tar"),
      arguments: ["-xzf", archive.path, "-C", stage.path],
      progress: progress
    )
    guard unpack.status == 0, isSourceRoot(stage) else {
      throw DesktopError.message("随应用提供的源码解压失败：\n\(unpack.output)")
    }
    if let bootstrapVersion {
      try "\(bootstrapVersion)\n".write(
        to: stage.appendingPathComponent(Self.bootstrapVersionFile),
        atomically: true,
        encoding: .utf8
      )
    }
    if FileManager.default.fileExists(atPath: bootstrap.path) {
      try FileManager.default.removeItem(at: bootstrap)
    }
    try FileManager.default.moveItem(at: stage, to: bootstrap)
  }

  private func isSourceRoot(_ url: URL) -> Bool {
    FileManager.default.fileExists(atPath: url.appendingPathComponent("apps/cli/package.json").path)
  }

  private func prepare(_ source: URL, progress: @escaping @Sendable (String) -> Void) throws {
    let artifact = source.appendingPathComponent("apps/cli/lib/bin.js")
    let frontend = source.appendingPathComponent("apps/web/dist/index.html")
    let artifactsReady = FileManager.default.fileExists(atPath: artifact.path)
      && FileManager.default.fileExists(atPath: frontend.path)
    let dependenciesReady = FileManager.default.fileExists(
      atPath: source.appendingPathComponent(
        "apps/cli/node_modules/@deepseek-ai/dsh-app-boot/package.json"
      ).path
    )
    let hasLockfile = FileManager.default.fileExists(
      atPath: source.appendingPathComponent("pnpm-lock.yaml").path
    )
    // Distribution snapshots contain built artifacts and the lockfile, but
    // omit node_modules so they remain portable across machines. Install the
    // workspace links before launching the prebuilt CLI.
    if artifactsReady, dependenciesReady || !hasLockfile { return }

    let toolchain = try Toolchain.resolve(supportRoot: supportRoot, progress: progress)
    if !dependenciesReady {
      progress("正在安装源码依赖…\n")
      let install = try CommandRunner.run(
        executable: toolchain.npx,
        arguments: ["--yes", "pnpm@11.7.0", "install", "--frozen-lockfile"],
        directory: source,
        environment: toolchain.environment(),
        progress: progress
      )
      guard install.status == 0 else { throw DesktopError.message("依赖安装失败：\n\(install.output)") }
    }

    if artifactsReady { return }

    progress("正在构建 DeepSeek Harness…\n")
    let build = try CommandRunner.run(
      executable: toolchain.npx,
      arguments: ["--yes", "pnpm@11.7.0", "run", "build"],
      directory: source,
      environment: toolchain.environment(),
      progress: progress
    )
    guard build.status == 0 else { throw DesktopError.message("源码构建失败：\n\(build.output)") }
  }

  func update(
    current: URL,
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<SourceUpdate, Error>) -> Void
  ) {
    queue.async {
      do {
        progress("正在获取上游更新…\n")
        let repository = try self.ensureRemoteRepository(progress: progress)
        let fetch = try CommandRunner.run(
          executable: URL(fileURLWithPath: "/usr/bin/git"),
          arguments: ["-C", repository.path, "fetch", "--prune", "origin", self.sourceBranch],
          progress: progress
        )
        guard fetch.status == 0 else { throw DesktopError.message("获取上游更新失败：\n\(fetch.output)") }
        let remote = try self.gitOutput(["-C", repository.path, "rev-parse", "origin/\(self.sourceBranch)"])
        let currentIsRepository = FileManager.default.fileExists(
          atPath: current.appendingPathComponent(".git").path
        )
        let local = currentIsRepository
          ? try self.gitOutput(["-C", current.path, "rev-parse", "HEAD"])
          : nil
        if local == nil {
          progress("当前版本是随 App 提供的源码快照，将从远程仓库创建更新版本…\n")
        }
        let topology: SourceUpdateTopology
        if let local {
          topology = try Self.updateTopology(
            sameCommit: remote == local,
            remoteContainsLocal: self.isAncestor(local, of: remote, in: repository),
            localContainsRemote: self.isAncestor(remote, of: local, in: repository)
          )
        } else {
          topology = .fastForward
        }
        if topology == .unchanged || topology == .localAhead {
          completion(.success(SourceUpdate(sourceRoot: current, commit: local ?? remote, changed: false)))
          return
        }
        guard topology == .fastForward else {
          throw DesktopError.message(
            "官方源码与本地桌面改动已经分叉。自动更新已停止，以免丢失本地功能；请先在源码仓库中合并官方更新。"
          )
        }

        let releases = self.supportRoot.appendingPathComponent("releases", isDirectory: true)
        try FileManager.default.createDirectory(at: releases, withIntermediateDirectories: true)
        var stage = releases.appendingPathComponent(remote, isDirectory: true)
        if !self.isSourceRoot(stage) {
          if FileManager.default.fileExists(atPath: stage.path) {
            stage = releases.appendingPathComponent("\(remote)-\(Int(Date().timeIntervalSince1970))", isDirectory: true)
          }
          progress("正在创建隔离的更新 worktree…\n")
          let worktree = try CommandRunner.run(
            executable: URL(fileURLWithPath: "/usr/bin/git"),
            arguments: ["-C", repository.path, "worktree", "add", "--detach", stage.path, remote],
            progress: progress
          )
          guard worktree.status == 0 else { throw DesktopError.message("创建更新 worktree 失败：\n\(worktree.output)") }
        }

        if try self.overlayManagedExtensions(from: current, into: stage) {
          try self.refreshLockfile(at: stage, progress: progress)
        }
        try self.prepare(stage, progress: progress)
        progress("正在执行本地健康检查…\n")
        try RuntimeController.healthCheck(
          sourceRoot: stage,
          dshHome: self.probeHome,
          supportRoot: self.supportRoot,
          progress: progress
        )
        self.defaults.set(current.path, forKey: "previousSourceRoot")
        self.defaults.set(stage.path, forKey: "activeSourceRoot")
        try self.recordSourceRelease(source: stage, commit: remote, active: true)
        completion(.success(SourceUpdate(sourceRoot: stage, commit: remote, changed: true)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  /// Resolve a Git repository used exclusively for remote source updates.
  /// Distribution snapshots intentionally omit `.git`, so update operations
  /// must never run `git fetch` against the active unpacked source directory.
  private func ensureRemoteRepository(
    progress: @escaping @Sendable (String) -> Void
  ) throws -> URL {
    let repository = supportRoot.appendingPathComponent("source-repository", isDirectory: true)
    let gitDirectory = repository.appendingPathComponent(".git", isDirectory: true)
    if FileManager.default.fileExists(atPath: gitDirectory.path) {
      return repository
    }
    if FileManager.default.fileExists(atPath: repository.path) {
      try FileManager.default.removeItem(at: repository)
    }
    progress("正在从 GitHub 获取源码仓库…\n")
    let clone = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/git"),
      arguments: ["clone", "--branch", sourceBranch, sourceRepository, repository.path],
      progress: progress
    )
    guard clone.status == 0, FileManager.default.fileExists(atPath: gitDirectory.path) else {
      throw DesktopError.message("源码仓库下载失败：\n\(clone.output)")
    }
    return repository
  }

  /// Keep the desktop-owned runtime packages available when the upstream
  /// source repository is on an older commit or omits the plugin workspace.
  @discardableResult
  private func overlayManagedExtensions(from current: URL, into stage: URL) throws -> Bool {
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: current.appendingPathComponent(Self.managedExtensionPaths[0]).path) else {
      return false
    }
    for relativePath in Self.managedExtensionPaths {
      let source = current.appendingPathComponent(relativePath)
      guard fileManager.fileExists(atPath: source.path) else {
        throw DesktopError.message("当前版本缺少桌面内置扩展：\(relativePath)")
      }
      let target = stage.appendingPathComponent(relativePath)
      try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
      try fileManager.copyItem(at: source, to: target)
    }
    return true
  }

  private func refreshLockfile(at source: URL, progress: @escaping @Sendable (String) -> Void) throws {
    let toolchain = try Toolchain.resolve(supportRoot: supportRoot, progress: progress)
    let result = try CommandRunner.run(
      executable: toolchain.npx,
      arguments: ["--yes", "pnpm@11.7.0", "install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"],
      directory: source,
      environment: toolchain.environment(),
      progress: progress
    )
    guard result.status == 0 else { throw DesktopError.message("更新源码依赖清单失败：\n\(result.output)") }
  }

  private func recordSourceRelease(source: URL, commit explicitCommit: String? = nil, active: Bool) throws {
    let commit: String
    if let explicitCommit {
      commit = explicitCommit
    } else if FileManager.default.fileExists(atPath: source.appendingPathComponent(".git").path) {
      commit = (try? gitOutput(["-C", source.path, "rev-parse", "HEAD"]))
        ?? bootstrapVersion
        ?? "bootstrap:\(source.lastPathComponent)"
    } else {
      commit = bootstrapVersion ?? "bootstrap:\(source.lastPathComponent)"
    }
    let store = try DesktopDataStore(supportRoot: supportRoot)
    defer { store.close() }
    try store.initialize()
    try store.recordSourceRelease(
      commit: commit,
      repository: sourceRepository,
      branch: sourceBranch,
      sourcePath: source.path,
      active: active
    )
  }

  func rollback(current: URL) throws -> URL {
    guard let path = defaults.string(forKey: "previousSourceRoot") else {
      throw DesktopError.message("没有可回退的上一个源码版本。")
    }
    let previous = URL(fileURLWithPath: path, isDirectory: true)
    guard isSourceRoot(previous) else { throw DesktopError.message("上一个源码版本已不存在。") }
    defaults.set(current.path, forKey: "previousSourceRoot")
    defaults.set(previous.path, forKey: "activeSourceRoot")
    try recordSourceRelease(source: previous, active: true)
    return previous
  }

  private func gitOutput(_ arguments: [String]) throws -> String {
    let result = try CommandRunner.run(executable: URL(fileURLWithPath: "/usr/bin/git"), arguments: arguments)
    guard result.status == 0 else { throw DesktopError.message("git 命令失败：\n\(result.output)") }
    return result.output.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func isAncestor(_ ancestor: String, of descendant: String, in repository: URL) throws -> Bool {
    let result = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/git"),
      arguments: ["-C", repository.path, "merge-base", "--is-ancestor", ancestor, descendant]
    )
    if result.status == 0 { return true }
    if result.status == 1 { return false }
    throw DesktopError.message("无法比较源码版本：\n\(result.output)")
  }
}
