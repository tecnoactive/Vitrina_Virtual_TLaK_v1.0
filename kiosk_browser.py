import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.0')
from gi.repository import Gtk, WebKit2, GLib
import signal
import sys

class KioskBrowser(Gtk.Window):
    def __init__(self):
        super(KioskBrowser, self).__init__()
        
        # Configurar la ventana principal
        self.fullscreen()
        self.set_decorated(False)
        
        # Crear el WebView
        self.webview = WebKit2.WebView()
        self.webview.connect('load-failed', self.on_load_failed)
        
        # Configuraciones para mejorar el rendimiento
        settings = self.webview.get_settings()
        settings.set_property('enable-webgl', False)
        settings.set_property('enable-accelerated-compositing', False)
        settings.set_property('enable-smooth-scrolling', False)
        settings.set_property('enable-media-stream', True)  # Para WebSocket
        
        # Configurar cache
        context = WebKit2.WebContext.get_default()
        context.set_cache_model(WebKit2.CacheModel.DOCUMENT_VIEWER)
        
        # Configurar política de memoria
        context.set_web_process_count_limit(1)  # Limitar a un solo proceso web
        
        # Agregar el WebView a la ventana
        self.add(self.webview)
        
        # Cargar la URL
        self.webview.load_uri('http://localhost:5000')
        
        # Mostrar todo
        self.connect('destroy', self.on_destroy)
        self.show_all()
        
        # Configurar temporizador para monitoreo de memoria
        GLib.timeout_add_seconds(60, self.check_memory)
    
    def on_load_failed(self, webview, event, url, error):
        print(f"Error cargando {url}: {error}")
        # Reintentar después de 5 segundos
        GLib.timeout_add_seconds(5, self.reload_page)
        return True
    
    def reload_page(self):
        self.webview.load_uri('http://localhost:5000')
        return False
    
    def check_memory(self):
        import psutil
        process = psutil.Process()
        memory_percent = process.memory_percent()
        
        if memory_percent > 80:  # Si usa más del 80% de memoria
            print("Alto uso de memoria detectado, recargando...")
            self.reload_page()
        
        return True  # Mantener el temporizador activo
    
    def on_destroy(self, window):
        Gtk.main_quit()

def signal_handler(sig, frame):
    print('Cerrando aplicación...')
    Gtk.main_quit()
    sys.exit(0)

if __name__ == '__main__':
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    browser = KioskBrowser()
    Gtk.main()
