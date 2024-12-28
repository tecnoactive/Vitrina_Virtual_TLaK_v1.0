from PyQt5.QtWidgets import QApplication
from PyQt5.QtWebEngineWidgets import QWebEngineView
from PyQt5.QtCore import Qt
import sys

class KioskBrowser(QWebEngineView):
    def __init__(self, url):
        super().__init__()
        self.setWindowFlag(Qt.FramelessWindowHint)  # Sin bordes
        self.showFullScreen()  # Pantalla completa
        self.load(url)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    url = "http://localhost:5000"
    browser = KioskBrowser(url)
    browser.show()
    sys.exit(app.exec_())

