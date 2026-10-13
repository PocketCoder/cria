import XCTest
@testable import CriaKit

/// Slot that fails like a locked Keychain and records any write attempt.
private final class FailingSlot: SecretSlot, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var writes = 0

    func read() throws -> String? { throw KeychainError(status: -25308) }
    func write(_ value: String) throws {
        lock.withLock { writes += 1 }
        throw KeychainError(status: -25308)
    }
    func delete() throws { throw KeychainError(status: -25308) }
}

final class CredentialStoreTests: XCTestCase {
    private let creds = Credentials(serverURL: "https://vk.example", token: "tok", authMethod: .password, refreshToken: "ref")

    func testRoundTripsWholeCredentialInOneSlot() throws {
        let slot = MemorySlot()
        let store = CredentialStore(slot: slot)
        try store.save(creds)
        XCTAssertEqual(store.load(), creds)
        let raw = try XCTUnwrap(try slot.read())
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: String])
        XCTAssertEqual(object["serverUrl"], "https://vk.example")
        XCTAssertEqual(object["refreshToken"], "ref")
    }

    func testTransientKeychainErrorOnSaveThrowsAndWritesNowhereElse() {
        let slot = FailingSlot()
        let store = CredentialStore(slot: slot)
        XCTAssertThrowsError(try store.save(creds))
        XCTAssertEqual(slot.writes, 1)
        XCTAssertNil(UserDefaults.standard.string(forKey: "cria:token/v1"))
        XCTAssertNil(UserDefaults.standard.string(forKey: "cria:refresh/v1"))
    }

    func testUnreadableKeychainIsSignedOut() {
        XCTAssertNil(CredentialStore(slot: FailingSlot()).load())
    }

    func testCorruptBlobIsSignedOut() throws {
        XCTAssertNil(CredentialStore(slot: MemorySlot("not json")).load())
        XCTAssertNil(CredentialStore(slot: MemorySlot(#"{"serverUrl": "x"}"#)).load())
    }

    func testUnknownAuthMethodNormalisesToToken() throws {
        let store = CredentialStore(slot: MemorySlot(#"{"serverUrl": "https://a", "token": "t", "authMethod": "weird"}"#))
        XCTAssertEqual(store.load(), Credentials(serverURL: "https://a", token: "t", authMethod: .token))
    }

    func testReadsBlobWrittenByTauriClient() {
        let store = CredentialStore(slot: MemorySlot(
            #"{"serverUrl": "https://a", "token": "t", "authMethod": "linkShare", "refreshToken": "r"}"#))
        XCTAssertEqual(store.load()?.authMethod, .linkShare)
        XCTAssertEqual(store.load()?.refreshToken, "r")
    }

    func testClearWipesSlotAndSurvivesErrors() throws {
        let slot = MemorySlot()
        let store = CredentialStore(slot: slot)
        try store.save(creds)
        store.clear()
        XCTAssertNil(try slot.read())
        CredentialStore(slot: FailingSlot()).clear()
    }
}

final class LegacyCredentialImportTests: XCTestCase {
    private let json = #"{"serverUrl":"https://vk.example","token":"tok","authMethod":"password","refreshToken":"ref"}"#

    private func makeImport(_ slot: any SecretSlot, ran: LockedFlag = LockedFlag()) -> LegacyCredentialImport {
        LegacyCredentialImport(slot: slot, hasRun: { ran.value }, markRun: { ran.value = true })
    }

    func testReadsTheTauriJSONOnce() {
        let ran = LockedFlag()
        let legacy = makeImport(MemorySlot(json), ran: ran)
        XCTAssertEqual(legacy.credentials()?.token, "tok")
        XCTAssertNil(legacy.credentials(), "second call must do nothing")
    }

    func testMissingItemMarksDone() {
        let ran = LockedFlag()
        XCTAssertNil(makeImport(MemorySlot(), ran: ran).credentials())
        XCTAssertTrue(ran.value)
    }

    func testUnreadableItemIsRetriedNextLaunch() {
        let ran = LockedFlag()
        XCTAssertNil(makeImport(FailingSlot(), ran: ran).credentials())
        XCTAssertFalse(ran.value)
    }

    func testHydrateAdoptsAndSavesIntoTheNativeSlot() async throws {
        let native = MemorySlot()
        let session = AuthSession(store: CredentialStore(slot: native), legacyImport: makeImport(MemorySlot(json)))
        await session.hydrate()
        let status = await session.status
        XCTAssertEqual(status, .authenticated(Credentials(serverURL: "https://vk.example", token: "tok", authMethod: .password, refreshToken: "ref")))
        XCTAssertNotNil(try native.read())
    }

    func testSignOutIsNotUndoneByTheImport() async {
        let ran = LockedFlag()
        let native = MemorySlot()
        let session = AuthSession(store: CredentialStore(slot: native), legacyImport: makeImport(MemorySlot(json), ran: ran))
        await session.hydrate()
        await session.signOut()
        await session.hydrate()
        let status = await session.status
        XCTAssertEqual(status, .unauthenticated)
    }

    func testTauriAccountNames() {
        XCTAssertEqual(LegacyCredentialImport.tauriAccount(bundleIdentifier: "io.cria.app"), "vikunja-token")
        XCTAssertEqual(LegacyCredentialImport.tauriAccount(bundleIdentifier: "io.cria.app.dev"), "vikunja-token.dev")
        XCTAssertEqual(LegacyCredentialImport.tauriAccount(bundleIdentifier: "io.cria.app.nightly"), "vikunja-token.nightly")
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false
    var value: Bool {
        get { lock.withLock { flag } }
        set { lock.withLock { flag = newValue } }
    }
}
