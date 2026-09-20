import Foundation
import Testing
@testable import DeepSeekHarnessDesktop

/// The Computer Use client package ships with the application: source updates
/// preserve it, the plugin inventory reports it, and profile cleanup never
/// writes it as a profile bundle. These checks pin each list so a future
/// distribution addition cannot leave this package half-wired.
private let computerUsePackage = "packages/client/ui-computer-use"
private let computerUsePackageName = "@deepseek-ai/dsh-client-ui-computer-use"

@Test func managedExtensionOverlayCarriesTheComputerUseClientPackage() throws {
  #expect(SourceManager.overlayManagedExtensionPaths.contains(computerUsePackage))
}

@Test func sourceUpdatePreservesTheApplicationOwnedComputerUsePackage() throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-managed-overlay-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let current = temporaryRoot.appendingPathComponent("current", isDirectory: true)
  let stage = temporaryRoot.appendingPathComponent("stage", isDirectory: true)
  let sourceManager = SourceManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    bootstrapArchive: nil
  )
  let paths = SourceManager.overlayManagedExtensionPaths
  for path in paths {
    try FileManager.default.createDirectory(
      at: current.appendingPathComponent(path, isDirectory: true),
      withIntermediateDirectories: true
    )
  }
  try Data("{\"name\":\"\(computerUsePackageName)\"}\n".utf8)
    .write(to: current.appendingPathComponent(computerUsePackage).appendingPathComponent("package.json"))

  let overlayed = try sourceManager.overlayManagedExtensionsForTesting(from: current, into: stage)

  #expect(overlayed)
  #expect(
    FileManager.default.fileExists(
      atPath: stage.appendingPathComponent(computerUsePackage).appendingPathComponent("package.json").path
    )
  )
}

@Test func pluginInventoryTreatsTheComputerUseClientPackageAsAppManaged() throws {
  let embedded = PluginManager.clientOnlyBundleInventory
  #expect(embedded.contains(computerUsePackageName))
}

@Test func profileCleanupNeverWritesTheComputerUseClientPackageAsABundle() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-client-only-cleanup-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let profileRoot = temporaryRoot.appendingPathComponent("home/profiles/desktop-lite", isDirectory: true)
  try FileManager.default.createDirectory(at: profileRoot, withIntermediateDirectories: true)
  try Data(
    #"{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","\#(computerUsePackageName)"]}}}"#.utf8
  ).write(to: profileRoot.appendingPathComponent("package.json"))
  let manager = PluginManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    dshHome: temporaryRoot.appendingPathComponent("home", isDirectory: true)
  )

  try await withCheckedThrowingContinuation { continuation in
    manager.ensureManagedProfile(sourceRoot: temporaryRoot, progress: { _ in }) {
      continuation.resume(with: $0)
    }
  }

  let data = try Data(contentsOf: profileRoot.appendingPathComponent("package.json"))
  let root = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let profile = try #require((root["dsh"] as? [String: Any])?["profile"] as? [String: Any])
  let bundles = try #require(profile["bundles"] as? [String])
  #expect(!bundles.contains(computerUsePackageName))
  #expect(bundles.contains("@deepseek-ai/dsh-base"))
}
