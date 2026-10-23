package com.park10.totem

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var bluetoothSocket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    private var connectedDeviceName: String? = null

    companion object {
        private const val TAG = "Park10Totem"
        // UUID estándar SPP (Serial Port Profile) para impresoras térmicas ESC/POS
        private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private val bluetoothPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions.entries.all { it.value }
        if (!granted) {
            Toast.makeText(this, "Permisos Bluetooth necesarios para la impresora", Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Forzar orientación horizontal (Landscape) en Modo Kiosko Tótem
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

        // Modo Kiosko: Pantalla siempre encendida
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Usar área completa incluyendo display cutout (cámara notch/punch-hole)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        // Configuración de pantalla completa inmersiva (Sticky Kiosk Mode)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        applyImmersiveFullscreen()

        requestBluetoothPermissions()

        webView = WebView(this).apply {
            id = View.generateViewId()
        }
        setContentView(webView)

        configureWebView()
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveFullscreen()
        }
    }

    private fun applyImmersiveFullscreen() {
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = false
        insetsController.isAppearanceLightNavigationBars = false
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        insetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun requestBluetoothPermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_SCAN)
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }

        if (permissions.isNotEmpty()) {
            bluetoothPermissionLauncher.launch(permissions.toTypedArray())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                view?.evaluateJavascript("window.isTotemKioskApp = true;", null)
            }
        }

        // Exponer la interfaz BluetoothPrinterBridge en window.AndroidPrinter
        webView.addJavascriptInterface(BluetoothPrinterBridge(), "AndroidPrinter")
    }

    override fun onDestroy() {
        super.onDestroy()
        closeBluetoothConnection()
    }

    @Synchronized
    private fun closeBluetoothConnection() {
        try {
            outputStream?.close()
            outputStream = null
            bluetoothSocket?.close()
            bluetoothSocket = null
            connectedDeviceName = null
        } catch (e: Exception) {
            Log.e(TAG, "Error cerrando conexión Bluetooth: ${e.message}")
        }
    }

    /**
     * Interfaz de comunicación con JavaScript para la impresora térmica
     */
    inner class BluetoothPrinterBridge {

        @JavascriptInterface
        fun isConnected(): Boolean {
            return bluetoothSocket?.isConnected == true
        }

        @JavascriptInterface
        fun getConnectedDeviceName(): String {
            return connectedDeviceName ?: ""
        }

        @JavascriptInterface
        fun getPairedDevices(): String {
            val jsonArray = JSONArray()
            val btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val btAdapter = btManager?.adapter ?: BluetoothAdapter.getDefaultAdapter()

            if (btAdapter == null || !btAdapter.isEnabled) {
                return jsonArray.toString()
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    return jsonArray.toString()
                }
            }

            try {
                val pairedDevices: Set<BluetoothDevice> = btAdapter.bondedDevices ?: emptySet()
                for (device in pairedDevices) {
                    val obj = JSONObject()
                    obj.put("name", device.name ?: "Dispositivo desconocido")
                    obj.put("address", device.address)
                    jsonArray.put(obj)
                }
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException leyendo dispositivos vinculados: ${e.message}")
            }

            return jsonArray.toString()
        }

        @JavascriptInterface
        fun connect(macAddress: String): Boolean {
            closeBluetoothConnection()

            val btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val btAdapter = btManager?.adapter ?: BluetoothAdapter.getDefaultAdapter()

            if (btAdapter == null || !btAdapter.isEnabled) {
                Log.e(TAG, "Bluetooth deshabilitado o no disponible")
                return false
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    Log.e(TAG, "Permiso BLUETOOTH_CONNECT no otorgado")
                    return false
                }
            }

            return try {
                val device = btAdapter.getRemoteDevice(macAddress)
                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                btAdapter.cancelDiscovery() // Mejorar velocidad de conexión
                socket.connect()

                this@MainActivity.bluetoothSocket = socket
                this@MainActivity.outputStream = socket.outputStream
                this@MainActivity.connectedDeviceName = device.name ?: macAddress

                Log.d(TAG, "Conectado exitosamente a ${device.name} ($macAddress)")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Error conectando a $macAddress: ${e.message}")
                closeBluetoothConnection()
                false
            }
        }

        @JavascriptInterface
        fun disconnect(): Boolean {
            closeBluetoothConnection()
            return true
        }

        @JavascriptInterface
        fun printBase64(base64Data: String): Boolean {
            val stream = outputStream
            val socket = bluetoothSocket

            if (stream == null || socket == null || !socket.isConnected) {
                Log.w(TAG, "Intento de impresión sin conexión activa")
                return false
            }

            return try {
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                val chunkSize = 512
                var offset = 0
                while (offset < bytes.size) {
                    val len = Math.min(chunkSize, bytes.size - offset)
                    stream.write(bytes, offset, len)
                    stream.flush()
                    offset += len
                    if (offset < bytes.size) {
                        Thread.sleep(15) // Pausa de 15ms para drenar el buffer del cabezal térmico
                    }
                }
                Log.d(TAG, "Datos ESC/POS enviados (${bytes.size} bytes) con chunking")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Error enviando bytes a impresora: ${e.message}")
                false
            }
        }

        @JavascriptInterface
        fun printText(text: String): Boolean {
            val stream = outputStream
            if (stream == null || bluetoothSocket?.isConnected != true) {
                return false
            }
            return try {
                stream.write(text.toByteArray(Charsets.ISO_8859_1))
                stream.flush()
                true
            } catch (e: Exception) {
                Log.e(TAG, "Error enviando texto plano: ${e.message}")
                false
            }
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
