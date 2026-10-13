import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Re-encodes a picked photo for the avatar upload. Vikunja only accepts formats it can decode (JPEG, PNG, GIF),
/// and the photo library hands out HEIC.
enum AvatarImage {
    /// Longest side after downscaling, in pixels.
    static let maxSide: CGFloat = 1024
    static let quality: CGFloat = 0.85

    /// JPEG data for any image `UIImage` can read, scaled down so its longest side is at most `maxSide`, with
    /// the photo's orientation applied. Nil when the data is not an image.
    @MainActor
    static func jpeg(from data: Data) -> Data? {
        #if os(macOS)
        return JPEGReencoder.jpeg(from: data, maxSide: maxSide, quality: quality)
        #else
        guard let image = PlatformImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let longest = max(image.size.width, image.size.height)
        let factor = min(1, maxSide / longest)
        let size = CGSize(width: max(1, (image.size.width * factor).rounded()), height: max(1, (image.size.height * factor).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            // JPEG has no alpha: a transparent PNG would otherwise come out black.
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.jpegData(compressionQuality: quality)
        #endif
    }
}
