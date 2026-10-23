@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title Park10 - Instalador Android

:: Obtener la ruta base del proyecto
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

:: 1. Localizar ADB
set "ADB_CMD=adb"
where adb >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_CMD=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
    ) else (
        echo [ERROR] No se encontro adb.exe en el sistema ni en Android SDK.
        echo Asegurate de tener Android SDK Platform-Tools instalado.
        pause
        exit /b 1
    )
)

:: 2. Localizar JAVA_HOME si no esta definido o no tiene java.exe
if not exist "%JAVA_HOME%\bin\java.exe" (
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    )
)
if exist "%JAVA_HOME%\bin" (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
)

:MENU
cls
echo ======================================================================
echo             PARK10 - INSTALADOR EN DISPOSITIVOS ANDROID
echo ======================================================================
echo.
echo Dispositivos detectados por ADB:
"%ADB_CMD%" devices -l
echo.
echo ----------------------------------------------------------------------
echo  Selecciona el programa que deseas instalar:
echo.
echo   [1] App TÓTEM (Kiosko Expendedor / Impresora Térmica)
echo   [2] App CLIENTE (Estacionamiento IoT / Escáner de Tickets)
echo   [3] Instalar AMBAS aplicaciones
echo   [4] Salir
echo ----------------------------------------------------------------------
set /p OPCION="Elige una opcion (1-4): "

if "%OPCION%"=="1" goto INSTALAR_TOTEM
if "%OPCION%"=="2" goto INSTALAR_CLIENTE
if "%OPCION%"=="3" goto INSTALAR_AMBAS
if "%OPCION%"=="4" goto FIN

echo Opcion invalida. Intenta nuevamente.
timeout /t 2 >nul
goto MENU

:PREGUNTAR_COMPILACION
set "COMPILAR=S"
echo.
set /p COMPILAR="Deseas sincronizar archivos web y compilar antes de instalar? (S/N) [S]: "
if /i "%COMPILAR%"=="" set "COMPILAR=S"
goto :eof

:: =====================================================================
:: ACCION: INSTALAR APP TOTEM
:: =====================================================================
:INSTALAR_TOTEM
cls
echo ======================================================================
echo             INSTALANDO APP TÓTEM (KIOSKO EXPENDEDOR)
echo ======================================================================
call :PREGUNTAR_COMPILACION

if /i "%COMPILAR%"=="S" (
    echo.
    echo [1/3] Sincronizando archivos web a assets de Android...
    copy /y "%ROOT_DIR%\totem-app\index.html" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\totem.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\styles.css" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\escpos-printer.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\firebase-totem.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\qrcode.bundle.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul

    echo [2/3] Compilando APK con Gradle (Totem)...
    cd /d "%ROOT_DIR%\totem-app\android"
    call gradlew.bat assembleDebug
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Fallo la compilacion de la App Totem.
        pause
        goto MENU
    )
    cd /d "%ROOT_DIR%"
) else (
    echo [INFO] Omitiendo compilacion, usando APK existente...
)

set "APK_TOTEM=%ROOT_DIR%\totem-app\android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "%APK_TOTEM%" (
    echo [ERROR] No se encontro el archivo APK en: "%APK_TOTEM%"
    pause
    goto MENU
)

echo.
echo [3/3] Instalando en el dispositivo...
"%ADB_CMD%" install -r -d "%APK_TOTEM%"
if %ERRORLEVEL% equ 0 (
    echo.
    echo [EXITO] App Totem instalada correctamente.
    echo Iniciando aplicacion en el dispositivo...
    "%ADB_CMD%" shell am start -n com.park10.totem.debug/com.park10.totem.MainActivity
) else (
    echo.
    echo [ERROR] Fallo la instalacion de la App Totem por ADB.
)

echo.
pause
goto MENU

:: =====================================================================
:: ACCION: INSTALAR APP CLIENTE
:: =====================================================================
:INSTALAR_CLIENTE
cls
echo ======================================================================
echo          INSTALANDO APP CLIENTE (ESTACIONAMIENTO IOT)
echo ======================================================================
call :PREGUNTAR_COMPILACION

if /i "%COMPILAR%"=="S" (
    echo.
    echo [1/3] Sincronizando archivos web a assets de Android...
    copy /y "%ROOT_DIR%\cliente-app\index.html" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\app.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\styles.css" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\firebase-service.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\iot-service.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\qr-scanner.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\qrcode.bundle.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\jsqr.bundle.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul

    echo [2/3] Compilando APK con Gradle (Cliente)...
    cd /d "%ROOT_DIR%\cliente-app\android"
    call gradlew.bat assembleDebug
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Fallo la compilacion de la App Cliente.
        pause
        goto MENU
    )
    cd /d "%ROOT_DIR%"
) else (
    echo [INFO] Omitiendo compilacion, usando APK existente...
)

set "APK_CLIENTE=%ROOT_DIR%\cliente-app\android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "%APK_CLIENTE%" (
    echo [ERROR] No se encontro el archivo APK en: "%APK_CLIENTE%"
    pause
    goto MENU
)

echo.
echo [3/3] Instalando en el dispositivo...
"%ADB_CMD%" install -r -d "%APK_CLIENTE%"
if %ERRORLEVEL% equ 0 (
    echo.
    echo [EXITO] App Cliente instalada correctamente.
    echo Iniciando aplicacion en el dispositivo...
    "%ADB_CMD%" shell am start -n com.park10.iot.debug/com.park10.iot.MainActivity
) else (
    echo.
    echo [ERROR] Fallo la instalacion de la App Cliente por ADB.
)

echo.
pause
goto MENU

:: =====================================================================
:: ACCION: INSTALAR AMBAS
:: =====================================================================
:INSTALAR_AMBAS
cls
echo ======================================================================
echo                   INSTALANDO AMBAS APLICACIONES
echo ======================================================================
call :PREGUNTAR_COMPILACION

if /i "%COMPILAR%"=="S" (
    echo.
    echo [1/4] Sincronizando archivos y compilando App Totem...
    copy /y "%ROOT_DIR%\totem-app\index.html" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\totem.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\styles.css" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\escpos-printer.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\firebase-totem.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\totem-app\qrcode.bundle.js" "%ROOT_DIR%\totem-app\android\app\src\main\assets\" >nul

    cd /d "%ROOT_DIR%\totem-app\android"
    call gradlew.bat assembleDebug

    echo.
    echo [2/4] Sincronizando archivos y compilando App Cliente...
    copy /y "%ROOT_DIR%\cliente-app\index.html" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\app.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\styles.css" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\firebase-service.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\iot-service.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\qr-scanner.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\qrcode.bundle.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul
    copy /y "%ROOT_DIR%\cliente-app\jsqr.bundle.js" "%ROOT_DIR%\cliente-app\android\app\src\main\assets\" >nul

    cd /d "%ROOT_DIR%\cliente-app\android"
    call gradlew.bat assembleDebug
    cd /d "%ROOT_DIR%"
)

set "APK_TOTEM=%ROOT_DIR%\totem-app\android\app\build\outputs\apk\debug\app-debug.apk"
set "APK_CLIENTE=%ROOT_DIR%\cliente-app\android\app\build\outputs\apk\debug\app-debug.apk"

echo.
echo [3/4] Instalando App Totem...
"%ADB_CMD%" install -r -d "%APK_TOTEM%"

echo.
echo [4/4] Instalando App Cliente...
"%ADB_CMD%" install -r -d "%APK_CLIENTE%"

echo.
echo [EXITO] Ambas aplicaciones han sido procesadas e instaladas.
pause
goto MENU

:FIN
echo.
echo Saliendo del instalador...
exit /b 0
