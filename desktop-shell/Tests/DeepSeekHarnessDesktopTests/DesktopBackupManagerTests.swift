import Foundation
import Testing
@testable import DeepSeekHarnessDesktop

@Test func desktopConfigurationBackupRoundTripsWithoutReplacingSessions() throws {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-desktop-backup-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: root) }

  let support = root.appendingPathComponent("support", isDirectory: true)
  let data = support.appendingPathComponent("data", isDirectory: true)
  let profile = data.appendingPathComponent("profiles/web", isDirectory: true)
  let desktopProfile = data.appendingPathComponent("profiles/desktop-lite", isDirectory: true)
  let skill = data.appendingPathComponent("skills/example", isDirectory: true)
  try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: desktopProfile, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: skill, withIntermediateDirectories: true)
  try Data(#"{"dependencies":{"custom-plugin":"1.2.3"},"dsh":{"profile":{"bundles":["custom-plugin"]}}}"#.utf8)
    .write(to: profile.appendingPathComponent("package.json"))
  try Data(#"{"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-desktop-lite"]}}}"#.utf8)
    .write(to: desktopProfile.appendingPathComponent("package.json"))
  try Data("# Example\n".utf8)
    .write(to: skill.appendingPathComponent("SKILL.md"))
  try Data("{\"agent-default-model\":{\"provider\":\"chiyun\",\"model\":\"deepseek-v4-flash\"}}\n".utf8)
    .write(to: data.appendingPathComponent("settings.yaml"))

  let desktop = data.appendingPathComponent("desktop", isDirectory: true)
  try FileManager.default.createDirectory(at: desktop, withIntermediateDirectories: true)
  let sessionDatabase = desktop.appendingPathComponent("dsh-desktop.sqlite")
  let sessionSetup = try CommandRunner.run(
    executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
    arguments: [sessionDatabase.path, "CREATE TABLE dsh_session_metadata(id TEXT PRIMARY KEY, header_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE dsh_session_events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, seq)); INSERT INTO dsh_session_metadata VALUES ('retained','{}','2026-09-13T00:00:00Z'); PRAGMA user_version=2;"]
  )
  #expect(sessionSetup.status == 0)
  let sessionBytes = try Data(contentsOf: sessionDatabase)

  let archive = root.appendingPathComponent("configuration.dshbackup")
  try DesktopBackupManager(supportRoot: support).export(to: archive)

  #expect(FileManager.default.fileExists(atPath: archive.path))
  #expect((try Data(contentsOf: archive)).isEmpty == false)
  let archiveAttributes = try FileManager.default.attributesOfItem(atPath: archive.path)
  #expect((archiveAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)

  try Data("{}\n".utf8).write(to: data.appendingPathComponent("settings.yaml"))
  try FileManager.default.removeItem(at: skill)
  try DesktopBackupManager(supportRoot: support, dataRoot: data).import(from: archive)

  let settings = try #require(
    try JSONSerialization.jsonObject(with: Data(contentsOf: data.appendingPathComponent("settings.yaml"))) as? [String: Any]
  )
  #expect((settings["agent-default-model"] as? [String: String])?["provider"] == "chiyun")
  #expect(FileManager.default.fileExists(atPath: skill.appendingPathComponent("SKILL.md").path))
  #expect(try Data(contentsOf: sessionDatabase) == sessionBytes)
}

@Test func legacyConfigurationImportPreservesSessionsAndMigratesDesktopProfile() throws {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-desktop-legacy-backup-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let support = root.appendingPathComponent("support", isDirectory: true)
  let data = support.appendingPathComponent("data", isDirectory: true)
  let desktop = data.appendingPathComponent("desktop", isDirectory: true)
  let desktopProfile = data.appendingPathComponent("profiles/desktop-lite", isDirectory: true)
  let currentSkill = data.appendingPathComponent("skills/current", isDirectory: true)
  try FileManager.default.createDirectory(at: desktop, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: desktopProfile, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: currentSkill, withIntermediateDirectories: true)
  let sessionDatabase = desktop.appendingPathComponent("dsh-desktop.sqlite")
  let sessionBytes = Data("current authoritative sessions".utf8)
  try sessionBytes.write(to: sessionDatabase)
  try Data("# Current\n".utf8).write(to: currentSkill.appendingPathComponent("SKILL.md"))
  try Data(#"{"dependencies":{"current-plugin":"1.0.0"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@deepseek-ai/dsh-desktop-lite","current-plugin"]}}}"#.utf8)
    .write(to: desktopProfile.appendingPathComponent("package.json"))

  let archiveRoot = root.appendingPathComponent("archive", isDirectory: true)
  let legacyProfile = archiveRoot.appendingPathComponent("profiles/web", isDirectory: true)
  let legacySkill = archiveRoot.appendingPathComponent("skills/imported", isDirectory: true)
  try FileManager.default.createDirectory(at: legacyProfile, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: legacySkill, withIntermediateDirectories: true)
  try Data(#"{"format":"dsh-desktop-configuration","version":1}"#.utf8)
    .write(to: archiveRoot.appendingPathComponent("manifest.json"))
  try Data(#"{"dependencies":{"dsh-dream-skin":"github:example/dsh-dream-skin#commit"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-model-catalog","dsh-dream-skin"]}}}"#.utf8)
    .write(to: legacyProfile.appendingPathComponent("package.json"))
  try Data("# Imported\n".utf8).write(to: legacySkill.appendingPathComponent("SKILL.md"))
  let legacyDatabase = archiveRoot.appendingPathComponent("dsh-desktop.sqlite")
  let setup = try CommandRunner.run(
    executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
    arguments: [legacyDatabase.path, #"CREATE TABLE settings(namespace TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO settings VALUES ('agent-default-model','{"provider":"chiyun","model":"deepseek-v4-flash"}','2026-09-13T00:00:00Z'); INSERT INTO settings VALUES ('llm-dsh-ai','{"providers":{"chiyun":{"baseURL":"https://example.invalid/v1"}}}','2026-09-13T00:00:00Z'); PRAGMA user_version=1;"#]
  )
  #expect(setup.status == 0)
  let archive = root.appendingPathComponent("legacy.dshbackup.zip")
  let compressed = try CommandRunner.run(
    executable: URL(fileURLWithPath: "/usr/bin/ditto"),
    arguments: ["-c", "-k", "--sequesterRsrc", archiveRoot.path, archive.path]
  )
  #expect(compressed.status == 0)

  try DesktopBackupManager(supportRoot: support, dataRoot: data).import(from: archive)

  #expect(try Data(contentsOf: sessionDatabase) == sessionBytes)
  let settings = try #require(
    try JSONSerialization.jsonObject(with: Data(contentsOf: data.appendingPathComponent("settings.yaml"))) as? [String: Any]
  )
  #expect((settings["agent-default-model"] as? [String: String])?["provider"] == "chiyun")
  #expect(settings["llm-dsh-ai"] == nil)
  let llmPiAi = try #require(settings["llm-pi-ai"] as? [String: Any])
  let providers = try #require(llmPiAi["providers"] as? [String: Any])
  #expect((providers["chiyun"] as? [String: String])?["baseURL"] == "https://example.invalid/v1")
  let attributes = try FileManager.default.attributesOfItem(atPath: data.appendingPathComponent("settings.yaml").path)
  #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
  let manifest = try #require(
    try JSONSerialization.jsonObject(with: Data(contentsOf: desktopProfile.appendingPathComponent("package.json"))) as? [String: Any]
  )
  let dependencies = try #require(manifest["dependencies"] as? [String: String])
  #expect(dependencies["current-plugin"] == "1.0.0")
  #expect(dependencies["dsh-dream-skin"] == "github:example/dsh-dream-skin#commit")
  let dsh = try #require(manifest["dsh"] as? [String: Any])
  let profile = try #require(dsh["profile"] as? [String: Any])
  let bundles = try #require(profile["bundles"] as? [String])
  #expect(bundles.contains("@deepseek-ai/dsh-desktop-lite"))
  #expect(!bundles.contains("dsh-dream-skin"))
  #expect(FileManager.default.fileExists(atPath: currentSkill.appendingPathComponent("SKILL.md").path))
  #expect(FileManager.default.fileExists(atPath: data.appendingPathComponent("skills/imported/SKILL.md").path))
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
    arguments: [active.path, "CREATE TABLE dsh_session_metadata(id TEXT PRIMARY KEY, header_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE dsh_session_events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, seq)); INSERT INTO dsh_session_metadata VALUES ('session-1','{}','2026-09-13T00:00:00Z'); INSERT INTO dsh_session_events VALUES ('session-1',1,'{\"type\":\"created\"}'); PRAGMA user_version=2;"]
  )
  #expect(setup.status == 0)

  let manager = DesktopBackupManager(supportRoot: support, dataRoot: data)
  let archive = root.appendingPathComponent("sessions.sqlite")
  try manager.exportSessions(to: archive)
  let archiveAttributes = try FileManager.default.attributesOfItem(atPath: archive.path)
  #expect((archiveAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
  try manager.resetSessions()
  #expect(!FileManager.default.fileExists(atPath: active.path))
  try manager.importSessions(from: archive)
  #expect(FileManager.default.fileExists(atPath: active.path))
  let restored = try CommandRunner.run(
    executable: URL(fileURLWithPath: "/usr/bin/sqlite3"),
    arguments: [active.path, "SELECT count(*) FROM dsh_session_metadata; SELECT count(*) FROM dsh_session_events;"]
  )
  #expect(restored.status == 0)
  #expect(restored.output.split(whereSeparator: \.isNewline).map(String.init) == ["1", "1"])
  let activeAttributes = try FileManager.default.attributesOfItem(atPath: active.path)
  #expect((activeAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
}
