import Foundation

/// A text-in, text-out language model. The app target supplies the Apple Foundation Models implementation; tests
/// supply a stub. Replaces the Tauri `ai_generate` bridge.
public protocol OnDeviceModel: Sendable {
    /// "available", or why the model cannot run (`appleIntelligenceNotEnabled`, `deviceNotEligible`, `modelNotReady`,
    /// `unsupportedOS`). Never throws.
    func availability() async -> String
    /// Throws with a message containing the native error code (see `AIPrompts.errorMessage`).
    func generate(instructions: String, prompt: String) async throws -> String
}

/// The features built on the model. The model never does date maths: it writes dates in words and the quick-add
/// parser resolves them when a line becomes a task.
public struct AIFeatures: Sendable {
    public static let available = "available"
    private let model: any OnDeviceModel

    public init(model: any OnDeviceModel) {
        self.model = model
    }

    /// Nil when the model can run, else the reason as text a person can act on. The app hides AI buttons when the
    /// reason is `unsupportedOS` or `deviceNotEligible` (nothing the user can fix).
    public func unavailableReason() async -> String? {
        let status = await model.availability()
        return status == Self.available ? nil : status
    }

    /// Whether AI buttons should show at all: the device can run it, even if it is not turned on or ready yet.
    public static func isOfferable(reason: String?) -> Bool {
        guard let reason else { return true }
        return !(reason.contains("unsupportedOS") || reason.contains("deviceNotEligible"))
    }

    public func ramble(_ text: String, context: AIPrompts.RambleContext) async throws -> [RambleDraft] {
        let output = try await model.generate(
            instructions: AIPrompts.rambleInstructions(context),
            prompt: AIPrompts.clip(text)
        )
        return Ramble.drafts(fromLines: AIPrompts.parseLines(output), mode: context.mode)
    }

    /// Up to eight subtask titles, without any that repeat the task itself or one of `existing` (its current
    /// subtasks).
    public func subtasks(title: String, descriptionHtml: String?, existing: [String] = []) async throws -> [String] {
        let output = try await model.generate(
            instructions: AIPrompts.subtaskInstructions,
            prompt: AIPrompts.subtaskPrompt(title: title, descriptionHtml: descriptionHtml)
        )
        let fresh = AIPrompts.newSubtasks(AIPrompts.parseLines(output), parentTitle: title, existing: existing)
        return Array(fresh.prefix(8))
    }

    /// A filter query for a request in words. The answer must pass the same parser Save uses; on a parse error the
    /// model gets one retry with the error fed back, and the second answer is returned as is for the user to fix.
    public func filterQuery(describing request: String, projects: [String], labels: [String],
                            now: Date = Date()) async throws -> String {
        let text = request.trimmingCharacters(in: .whitespacesAndNewlines)
        let instructions = AIPrompts.filterInstructions(projects: projects, labels: labels)
        let query = AIPrompts.cleanFilter(try await model.generate(instructions: instructions, prompt: AIPrompts.clip(text)))
        do {
            _ = try parseFilterQuery(query, now: now)
            return query
        } catch {
            let repair = AIPrompts.filterRepairPrompt(request: text, invalid: query, error: String(describing: error))
            return AIPrompts.cleanFilter(try await model.generate(instructions: instructions, prompt: AIPrompts.clip(repair)))
        }
    }

    public func summary(of comments: [AIPrompts.ThreadComment]) async throws -> String {
        let output = try await model.generate(
            instructions: AIPrompts.summaryInstructions,
            prompt: AIPrompts.commentsPrompt(comments)
        )
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Cleans OCR lines into list items. Falls back to the raw lines when the model returns nothing.
    public func tidyList(_ lines: [String]) async throws -> [String] {
        let output = try await model.generate(
            instructions: AIPrompts.tidyListInstructions,
            prompt: AIPrompts.clip(lines.joined(separator: "\n"))
        )
        let tidy = AIPrompts.parseLines(output)
        return tidy.isEmpty ? lines : tidy
    }
}
