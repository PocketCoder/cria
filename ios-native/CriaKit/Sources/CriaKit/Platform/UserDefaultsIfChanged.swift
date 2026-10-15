import Foundation

extension UserDefaults {
    /// Writes only when the stored value differs. `set` posts `didChangeNotification` even for an identical value, and
    /// SwiftUI answers that by re-evaluating every view that reads defaults (every task row on the Mac), so repeat
    /// writes from a screen's `.task` or a sync pass must go through here.
    public func setIfChanged(_ value: String, forKey key: String) {
        if string(forKey: key) != value { set(value, forKey: key) }
    }

    public func setIfChanged(_ value: Int, forKey key: String) {
        if object(forKey: key) as? Int != value { set(value, forKey: key) }
    }

    public func setIfChanged(_ value: Bool, forKey key: String) {
        if object(forKey: key) as? Bool != value { set(value, forKey: key) }
    }
}
