import Foundation
import Testing
@testable import DeepSeekHarnessDesktop

@Test func desktopBackupExportsAClosedSQLiteDatabaseAndArtifacts() throws {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-desktop-backup-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: root) }

  let support = root.appendingPathComponent("support", isDirectory: true)
  let data = support.appendingPathComponent("data", isDirectory: true)
  let profile = data.appendingPathComponent("profiles/web", isDirectory: true)
  let skill = data.appendingPathComponent("skills/example", isDirectory: true)
  try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: skill, withIntermediateDirectories: true)
  try Data(#"{"dsh":{"profile":{"bundles":[]}}}"#.utf8)
    .write(to: profile.appendingPathComponent("package.json"))
  try Data("# Example\n".utf8)
    .write(to: skill.appendingPathComponent("SKILL.md"))

  let store = try DesktopDataStore(supportRoot: support)
  try store.initialize()
  try store.recordAudit(
    id: "backup-test",
    timestamp: "2026-09-03T00:00:00Z",
    action: "test",
    subject: "backup",
    status: "success",
    message: "test"
  )
  store.close()

  let archive = root.appendingPathComponent("configuration.dshbackup")
  try DesktopBackupManager(supportRoot: support).export(to: archive)

  #expect(FileManager.default.fileExists(atPath: archive.path))
  #expect((try Data(contentsOf: archive)).isEmpty == false)
}
