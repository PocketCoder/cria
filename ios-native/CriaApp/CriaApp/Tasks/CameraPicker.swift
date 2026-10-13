import SwiftUI
import UIKit

/// Takes one photo with the system camera and hands back JPEG data. Only offered when a camera exists.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> CameraCoordinator {
        CameraCoordinator(onCapture: onCapture, onFinish: { dismiss() })
    }
}

final class CameraCoordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private let onCapture: (Data) -> Void
    private let onFinish: () -> Void

    init(onCapture: @escaping (Data) -> Void, onFinish: @escaping () -> Void) {
        self.onCapture = onCapture
        self.onFinish = onFinish
    }

    func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.85) {
            onCapture(data)
        }
        onFinish()
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        onFinish()
    }
}
