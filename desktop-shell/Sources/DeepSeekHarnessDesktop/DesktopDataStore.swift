import Foundation
import SQLite3

/// The desktop-owned SQLite catalog for durable user data.
///
/// Runtime providers use these tables for user data. Loader-executed profile
/// manifests and Skill source stay as file artifacts; their metadata is mirrored
/// here so upgrades can inventory and restore the executable files safely.
final class DesktopDataStore: @unchecked Sendable {
  static let schemaVersion = 1

  let databaseURL: URL
  private var database: OpaquePointer?

  init(supportRoot: URL) throws {
    let dataRoot = supportRoot.appendingPathComponent("data", isDirectory: true)
    try FileManager.default.createDirectory(at: dataRoot, withIntermediateDirectories: true)
    databaseURL = dataRoot.appendingPathComponent("dsh-desktop.sqlite")
    if FileManager.default.fileExists(atPath: databaseURL.path) {
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: databaseURL.path)
    }
  }

  deinit { close() }

  /// Open the database, apply the schema, and inventory legacy payloads.
  ///
  /// @param legacyHome - an optional pre-Application-Support Harness home.
  func initialize(legacyHome: URL? = nil) throws {
    guard database == nil else { return }
    var handle: OpaquePointer?
    let result = sqlite3_open_v2(
      databaseURL.path,
      &handle,
      SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
      nil
    )
    guard result == SQLITE_OK, let handle else {
      defer { if let handle { sqlite3_close(handle) } }
      throw DesktopError.message("无法打开桌面 SQLite 数据库：\(sqliteError(handle))")
    }
    database = handle
    do {
      try execute("PRAGMA journal_mode = WAL")
      try execute("PRAGMA synchronous = FULL")
      try execute("PRAGMA foreign_keys = ON")
      try execute(Self.schema)
      try migrateSchema()
      try setMetadata(key: "schema_version", value: String(Self.schemaVersion))
      // The desktop no longer presents the built-in official route. Remove
      // only the empty bootstrap row; a user-configured DeepSeek profile stays
      // intact and can still be re-enabled by an explicit profile overlay.
      try execute("DELETE FROM settings WHERE namespace = 'llm-deepseek' AND payload_json = '{}'")
      if let legacyHome { try inventoryLegacyHome(legacyHome) }
    } catch {
      close()
      throw error
    }
  }

  /// Return all inventory rows for diagnostics and migration verification.
  func inventory() throws -> [(relativePath: String, kind: String, bytes: Int64)] {
    guard database != nil else { throw DesktopError.message("桌面 SQLite 数据库尚未初始化。") }
    var statement: OpaquePointer?
    try prepare("SELECT relative_path, kind, bytes FROM data_inventory ORDER BY relative_path", &statement)
    defer { sqlite3_finalize(statement) }
    var rows: [(String, String, Int64)] = []
    while sqlite3_step(statement) == SQLITE_ROW {
      let path = String(cString: sqlite3_column_text(statement, 0))
      let kind = String(cString: sqlite3_column_text(statement, 1))
      rows.append((path, kind, sqlite3_column_int64(statement, 2)))
    }
    return rows
  }

  /// Copy the current file-backed payloads into their SQLite migration tables.
  /// The source files remain untouched so an interrupted upgrade can be rolled back.
  func synchronizePayloads(from root: URL, force: Bool = false) throws {
    guard database != nil else { throw DesktopError.message("桌面 SQLite 数据库尚未初始化。") }
    let marker = try metadataValue(for: "payload-import-v1")
    guard force || marker != "complete" else { return }
    let fileManager = FileManager.default
    try execute("BEGIN IMMEDIATE")
    do {
      for relative in ["settings.yaml", ".credentials.yaml", ".anonymous-user-id"] {
        let url = root.appendingPathComponent(relative)
        guard let content = try? String(contentsOf: url, encoding: .utf8) else { continue }
        let payload = try jsonPayload(format: "text", content: content)
        if relative == "settings.yaml" {
          try upsert(table: "settings", keyColumn: "namespace", key: "global", payload: payload)
        } else if relative == ".credentials.yaml" {
          try upsert(table: "credentials", keyColumn: "reference", key: "file", payload: payload)
        } else {
          try setMetadata(key: "anonymous-user-id", value: content.trimmingCharacters(in: .whitespacesAndNewlines))
        }
      }
      let workspace = root.appendingPathComponent("storages/workspace.json")
      if let content = try? String(contentsOf: workspace, encoding: .utf8) {
        try upsert(table: "workspaces", keyColumn: "id", key: "default", payload: content)
      }
      let projection = root.appendingPathComponent("storages/session_projcache.json")
      if let content = try? String(contentsOf: projection, encoding: .utf8) {
        try upsert(table: "workspaces", keyColumn: "id", key: "session-projection", payload: content)
      }
      let profiles = root.appendingPathComponent("profiles", isDirectory: true)
      if let entries = try? fileManager.contentsOfDirectory(at: profiles, includingPropertiesForKeys: [.isDirectoryKey]) {
        for entry in entries where (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
          let manifest = entry.appendingPathComponent("package.json")
          guard let content = try? String(contentsOf: manifest, encoding: .utf8) else { continue }
          try upsert(table: "profiles", keyColumn: "name", key: entry.lastPathComponent, payload: content)
          if let object = try? JSONSerialization.jsonObject(with: Data(content.utf8)) as? [String: Any],
             let dependencies = object["dependencies"] as? [String: String] {
            for (package, version) in dependencies {
              let config = try jsonPayload(format: "profile-dependency", content: entry.lastPathComponent)
              try upsertPlugin(package: package, version: version, config: config)
            }
          }
        }
      }
      let skills = root.appendingPathComponent("skills", isDirectory: true)
      if let enumerator = fileManager.enumerator(at: skills, includingPropertiesForKeys: [.isRegularFileKey]) {
        while let item = enumerator.nextObject() as? URL {
          let values = try item.resourceValues(forKeys: [.isRegularFileKey])
          guard values.isRegularFile == true else { continue }
          let identifier = item.path.replacingOccurrences(of: skills.path + "/", with: "")
          guard let content = try? String(contentsOf: item, encoding: .utf8) else { continue }
          try upsertSkill(identifier: identifier, payload: try jsonPayload(format: "file", content: content))
        }
      }
      let catalogs = root.appendingPathComponent("storages", isDirectory: true)
      if let entries = try? fileManager.contentsOfDirectory(at: catalogs, includingPropertiesForKeys: nil) {
        for entry in entries where entry.lastPathComponent.localizedCaseInsensitiveContains("model_catalog") {
          guard let content = try? String(contentsOf: entry, encoding: .utf8) else { continue }
          try upsert(table: "model_catalog", keyColumn: "provider", key: "default", payload: content)
        }
      }
      try setMetadata(key: "payload-import-v1", value: "complete")
      try execute("COMMIT")
    } catch {
      try? execute("ROLLBACK")
      throw error
    }
  }

  /// Record one plugin or source-management action in the SQLite audit table.
  func recordAudit(id: String, timestamp: String, action: String, subject: String, status: String, message: String) throws {
    guard database != nil else { throw DesktopError.message("桌面 SQLite 数据库尚未初始化。") }
    var statement: OpaquePointer?
    try prepare("INSERT OR REPLACE INTO audit_log(id, timestamp, action, subject, status, message) VALUES (?, ?, ?, ?, ?, ?)", &statement)
    defer { sqlite3_finalize(statement) }
    for (index, value) in [id, timestamp, action, subject, status, message].enumerated() {
      bind(value, to: statement, index: Int32(index + 1))
    }
    guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
  }

  /// Record a source revision used by the desktop update channel.
  ///
  /// @param commit - Git commit or immutable bootstrap identity.
  /// @param repository - Configured GitHub repository URL.
  /// @param branch - Configured branch or release channel.
  /// @param sourcePath - Prepared source tree used by the runtime.
  /// @param active - Whether this revision is the selected runtime source.
  func recordSourceRelease(commit: String, repository: String, branch: String, sourcePath: String, active: Bool) throws {
    guard database != nil else { throw DesktopError.message("桌面 SQLite 数据库尚未初始化。") }
    try execute("BEGIN IMMEDIATE")
    do {
      if active { try execute("UPDATE source_releases SET active = 0 WHERE active <> 0") }
      var statement: OpaquePointer?
      try prepare(
        "INSERT INTO source_releases(commit_hash, repository, branch, source_path, active, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) "
          + "ON CONFLICT(commit_hash) DO UPDATE SET repository = excluded.repository, branch = excluded.branch, source_path = excluded.source_path, active = excluded.active",
        &statement
      )
      defer { sqlite3_finalize(statement) }
      bind(commit, to: statement, index: 1)
      bind(repository, to: statement, index: 2)
      bind(branch, to: statement, index: 3)
      bind(sourcePath, to: statement, index: 4)
      sqlite3_bind_int(statement, 5, active ? 1 : 0)
      guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
      try execute("COMMIT")
    } catch {
      try? execute("ROLLBACK")
      throw error
    }
  }

  func close() {
    guard let database else { return }
    var logFrames: Int32 = 0
    var checkpointedFrames: Int32 = 0
    _ = sqlite3_wal_checkpoint_v2(
      database,
      nil,
      SQLITE_CHECKPOINT_TRUNCATE,
      &logFrames,
      &checkpointedFrames
    )
    sqlite3_close(database)
    self.database = nil
  }

  /// Apply monotonic SQLite schema migrations before any payload is written.
  /// A newer database is rejected explicitly so an older app cannot silently
  /// reinterpret user data after a downgrade.
  private func migrateSchema() throws {
    var statement: OpaquePointer?
    try prepare("PRAGMA user_version", &statement)
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { throw sqliteFailure(database) }
    let current = sqlite3_column_int(statement, 0)
    guard current <= Int32(Self.schemaVersion) else {
      throw DesktopError.message(
        "桌面 SQLite 数据库版本 (current) 高于此 App 支持的版本 (Self.schemaVersion)，请使用较新的 App 打开。"
      )
    }
    guard current < Int32(Self.schemaVersion) else { return }
    // Version 1 created the tables above. Future versions add one explicit
    // case here; no destructive or implicit downgrade is permitted.
    if current == 0 {
      try execute("PRAGMA user_version = \(Self.schemaVersion)")
    }
  }

  private func inventoryLegacyHome(_ home: URL) throws {
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: home.path) else { return }
    let root = home.standardizedFileURL
    guard let enumerator = fileManager.enumerator(
      at: root,
      includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
      options: []
    ) else { return }
    try execute("BEGIN IMMEDIATE")
    do {
      while let item = enumerator.nextObject() as? URL {
        let values = try item.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true else { continue }
        let relative = item.standardizedFileURL.path
          .replacingOccurrences(of: root.path, with: "")
          .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let kind = Self.kind(for: relative)
        try insertInventory(relativePath: relative, kind: kind, bytes: Int64(values.fileSize ?? 0), source: root.path)
      }
      // FileManager's directory enumerator may omit dot-files on some macOS
      // releases even without `skipsHiddenFiles`; account for the root secret
      // and identity records explicitly.
      for relative in [".credentials.yaml", ".anonymous-user-id"] {
        let item = root.appendingPathComponent(relative)
        guard fileManager.fileExists(atPath: item.path) else { continue }
        let values = try item.resourceValues(forKeys: [.fileSizeKey])
        try insertInventory(relativePath: relative, kind: Self.kind(for: relative), bytes: Int64(values.fileSize ?? 0), source: root.path)
      }
      try execute("COMMIT")
    } catch {
      try? execute("ROLLBACK")
      throw error
    }
  }

  private static func kind(for path: String) -> String {
    switch path {
    case "settings.yaml", "settings.yml", "settings.json": return "settings"
    case ".credentials.yaml", ".credentials.yml", ".credentials.json": return "credentials"
    case ".anonymous-user-id": return "identity"
    case "storages/workspace.json": return "workspace"
    case "storages/session_projcache.json": return "session-projection"
    case let value where value.hasPrefix("sessions/"): return "session-events"
    case let value where value.hasPrefix("attachments/"): return "attachment-bytes"
    case let value where value.hasPrefix("skills/"): return "skill"
    case let value where value.hasPrefix("profiles/"): return "profile"
    case let value where value.hasPrefix("storages/"): return "storage"
    default: return "unknown"
    }
  }

  private func insertInventory(relativePath: String, kind: String, bytes: Int64, source: String) throws {
    var statement: OpaquePointer?
    try prepare(
      "INSERT INTO data_inventory(relative_path, kind, bytes, source_path) VALUES (?, ?, ?, ?) "
        + "ON CONFLICT(relative_path) DO UPDATE SET kind = excluded.kind, bytes = excluded.bytes, source_path = excluded.source_path",
      &statement
    )
    defer { sqlite3_finalize(statement) }
    bind(relativePath, to: statement, index: 1)
    bind(kind, to: statement, index: 2)
    sqlite3_bind_int64(statement, 3, bytes)
    bind(source, to: statement, index: 4)
    guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
  }

  private func metadataValue(for key: String) throws -> String? {
    var statement: OpaquePointer?
    try prepare("SELECT value FROM metadata WHERE key = ?", &statement)
    defer { sqlite3_finalize(statement) }
    bind(key, to: statement, index: 1)
    guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
    return String(cString: sqlite3_column_text(statement, 0))
  }

  private func setMetadata(key: String, value: String) throws {
    var statement: OpaquePointer?
    try prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", &statement)
    defer { sqlite3_finalize(statement) }
    bind(key, to: statement, index: 1)
    bind(value, to: statement, index: 2)
    guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
  }

  private func jsonPayload(format: String, content: String) throws -> String {
    let object: [String: String] = ["format": format, "content": content]
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }

  private func upsert(table: String, keyColumn: String, key: String, payload: String) throws {
    var statement: OpaquePointer?
    try prepare("INSERT INTO \(table)(\(keyColumn), \(table == "profiles" ? "manifest_json" : table == "model_catalog" ? "catalog_json" : table == "skills" ? "manifest_json" : "payload_json"), updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(\(keyColumn)) DO UPDATE SET \(table == "profiles" ? "manifest_json" : table == "model_catalog" ? "catalog_json" : table == "skills" ? "manifest_json" : "payload_json") = excluded.\(table == "profiles" ? "manifest_json" : table == "model_catalog" ? "catalog_json" : table == "skills" ? "manifest_json" : "payload_json"), updated_at = excluded.updated_at", &statement)
    defer { sqlite3_finalize(statement) }
    bind(key, to: statement, index: 1)
    bind(payload, to: statement, index: 2)
    guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
  }

  private func upsertPlugin(package: String, version: String, config: String) throws {
    var statement: OpaquePointer?
    try prepare("INSERT INTO plugins(package_name, source, version, config_json, state, updated_at) VALUES (?, 'profile', ?, ?, 'installed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(package_name) DO UPDATE SET version = excluded.version, config_json = excluded.config_json, updated_at = excluded.updated_at", &statement)
    defer { sqlite3_finalize(statement) }
    bind(package, to: statement, index: 1)
    bind(version, to: statement, index: 2)
    bind(config, to: statement, index: 3)
    guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
  }

  private func upsertSkill(identifier: String, payload: String) throws {
    var statement: OpaquePointer?
    try prepare("INSERT INTO skills(identifier, source, manifest_json, state, updated_at) VALUES (?, 'legacy-files', ?, 'installed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(identifier) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at", &statement)
    defer { sqlite3_finalize(statement) }
    bind(identifier, to: statement, index: 1)
    bind(payload, to: statement, index: 2)
    guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteFailure(database) }
  }

  private func execute(_ sql: String) throws {
    var message: UnsafeMutablePointer<CChar>?
    guard sqlite3_exec(database, sql, nil, nil, &message) == SQLITE_OK else {
      let detail = message.map { String(cString: $0) } ?? sqliteError(database)
      sqlite3_free(message)
      throw DesktopError.message("桌面 SQLite 操作失败：\(detail)")
    }
  }

  private func prepare(_ sql: String, _ statement: inout OpaquePointer?) throws {
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
      throw sqliteFailure(database)
    }
  }

  private func bind(_ value: String, to statement: OpaquePointer?, index: Int32) {
    sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
  }

  private static let schema = """
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS data_inventory (
      relative_path TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      source_path TEXT NOT NULL,
      inventoried_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS settings (
      namespace TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS credentials (
      reference TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      header_json TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS session_events (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, seq)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS profiles (
      name TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS plugins (
      package_name TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      version TEXT,
      config_json TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS skills (
      identifier TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS model_catalog (
      provider TEXT PRIMARY KEY,
      catalog_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS source_releases (
      commit_hash TEXT PRIMARY KEY,
      repository TEXT NOT NULL,
      branch TEXT NOT NULL,
      source_path TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    ) STRICT;
    """
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private func sqliteError(_ database: OpaquePointer?) -> String {
  guard let database, let message = sqlite3_errmsg(database) else { return "unknown sqlite error" }
  return String(cString: message)
}

private func sqliteFailure(_ database: OpaquePointer?) -> DesktopError {
  DesktopError.message("桌面 SQLite 操作失败：\(sqliteError(database))")
}
