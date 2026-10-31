import Capacitor
import UIKit

final class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ExamMateMediaPlugin())
    }
}
