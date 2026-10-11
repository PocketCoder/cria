import XCTest
@testable import CriaKit

final class PositionTests: XCTestCase {
    func testCalculateWithoutNeighboursReturnsBaseStep() {
        XCTAssertEqual(Position.calculate(before: nil, after: nil), 1024)
    }

    func testCalculateWithOnlyBeforeOffsets() {
        XCTAssertEqual(Position.calculate(before: 5000, after: nil), 6024)
        XCTAssertEqual(Position.calculate(before: 0, after: nil), 1024)
    }

    func testCalculateWithOnlyAfterHalves() {
        XCTAssertEqual(Position.calculate(before: nil, after: 5000), 2500)
        XCTAssertEqual(Position.calculate(before: nil, after: 1000), 500)
    }

    func testCalculateMidpointAndFractions() {
        XCTAssertEqual(Position.calculate(before: 2000, after: 4000), 3000)
        XCTAssertEqual(Position.calculate(before: 0, after: 1024), 512)
        XCTAssertEqual(Position.calculate(before: 1, after: 2), 1.5)
    }

    func testCalculateCustomBaseStep() {
        XCTAssertEqual(Position.calculate(before: nil, after: nil, baseStep: 2048), 2048)
        XCTAssertEqual(Position.calculate(before: 5000, after: nil, baseStep: 2048), 7048)
    }

    func testCanMidpointRules() {
        XCTAssertFalse(Position.canMidpoint(before: nil, after: nil))
        XCTAssertTrue(Position.canMidpoint(before: 1024, after: nil))
        XCTAssertTrue(Position.canMidpoint(before: 0, after: nil))
        XCTAssertTrue(Position.canMidpoint(before: nil, after: 1024))
        XCTAssertFalse(Position.canMidpoint(before: nil, after: 0))
        XCTAssertTrue(Position.canMidpoint(before: 1024, after: 2048))
        XCTAssertFalse(Position.canMidpoint(before: 0, after: 0))
        XCTAssertFalse(Position.canMidpoint(before: 2048, after: 2048))
        XCTAssertFalse(Position.canMidpoint(before: 2048, after: 1024))
    }

    private func plan(_ order: [String], _ moved: String, _ positions: [String: Double]) -> ReorderPlan {
        Position.planReorder(orderedIds: order, movedId: moved) { positions[$0] }
    }

    func testPlanMidpointBetweenNeighbours() {
        let positions: [String: Double] = ["a": 1024, "b": 2048, "c": 0]
        XCTAssertEqual(plan(["a", "c", "b"], "c", positions), .midpoint(1536))
        XCTAssertEqual(plan(["c", "a", "b"], "c", positions), .midpoint(512))
        XCTAssertEqual(plan(["a", "b", "c"], "c", positions), .midpoint(3072))
    }

    func testPlanReindexesOnCollisionMissingOrUnknownId() {
        XCTAssertEqual(plan(["b", "a", "c"], "b", ["a": 0, "b": 0, "c": 0]), .reindex)
        XCTAssertEqual(plan(["a", "x", "b"], "x", ["b": 2048, "x": 0]), .reindex)
        XCTAssertEqual(plan(["a", "b"], "zzz", ["a": 1, "b": 2]), .reindex)
    }
}
