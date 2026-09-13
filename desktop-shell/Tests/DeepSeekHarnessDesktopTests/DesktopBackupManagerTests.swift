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

@Test func sessionDatabaseBackupRoundTripsAndResetsAuthoritativeStore() throws {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-session-backup-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let support = root.appendingPathComponent("support", isDirectory: true)
  let data = support.appendingPathComponent("data", isDirectory: true)
  let desktop = data.appendingPathComponent("desktop", isDirectory: true)
  try FileManager.default.createDirectory(at: desktop, withIntermediateDirectories: true)
  let active = desktop.appendingPathComponent("dsh-desktop.sqlite")
  let setup = try CommandRunner.run(
    executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
    arguments: [active.path, "CREATE TABLE dsh_session_metadata(id TEXT PRIMARY KEY, header_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE dsh_session_events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, seq)); PRAGMA user_version=2;"]
  )
  #expect(setup.status == 0)

  let manager = DesktopBackupManager(supportRoot: support, dataRoot: data)
  let archive = root.appendingPathComponent("sessions.sqlite")
  try manager.exportSessions(to: archive)
  try manager.resetSessions()
  #expect(!FileManager.default.fileExists(atPath: active.path))
  try manager.importSessions(from: archive)
  #expect(FileManager.default.fileExists(atPath: active.path))
}
