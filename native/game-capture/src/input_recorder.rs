use std::ffi::c_void;
use std::io::{self, Write};
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_LSHIFT, VK_RSHIFT, VK_SHIFT, VK_SPACE};
use windows::Win32::UI::Input::{
    GetRawInputData, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RID_INPUT,
    RIDEV_INPUTSINK, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE, RegisterRawInputDevices,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetForegroundWindow,
    HWND_MESSAGE, MSG, PM_REMOVE, PeekMessageW, RI_KEY_BREAK, RI_MOUSE_LEFT_BUTTON_DOWN,
    RI_MOUSE_LEFT_BUTTON_UP, RI_MOUSE_RIGHT_BUTTON_DOWN, RI_MOUSE_RIGHT_BUTTON_UP, RegisterClassW,
    TranslateMessage, WINDOW_EX_STYLE, WINDOW_STYLE, WM_DESTROY, WM_INPUT, WM_QUIT, WNDCLASSW,
};
use windows::core::{Error as WindowsError, PCWSTR, w};

use super::{CaptureError, start_parent_watchdog, start_stdin_watchdog};

const INPUT_PROTOCOL_VERSION: u8 = 1;
const MIN_SAMPLE_HZ: u32 = 30;
const MAX_SAMPLE_HZ: u32 = 240;
const KEY_W: u32 = 1 << 0;
const KEY_A: u32 = 1 << 1;
const KEY_S: u32 = 1 << 2;
const KEY_D: u32 = 1 << 3;
const KEY_R: u32 = 1 << 4;
const KEY_E: u32 = 1 << 5;
const KEY_SPACE: u32 = 1 << 6;
const KEY_SHIFT: u32 = 1 << 7;

static RAW_INPUT_STATE: OnceLock<Mutex<RawInputState>> = OnceLock::new();

#[derive(Debug)]
struct InputRecorderConfig {
    hwnd: u64,
    sample_hz: u32,
    session_id: String,
    parent_pid: u32,
    stop: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
struct RawInputState {
    target_hwnd: u64,
    keys: u32,
    mouse_dx: i64,
    mouse_dy: i64,
    fire: bool,
    aim: bool,
}

impl RawInputState {
    fn clear(&mut self) {
        self.keys = 0;
        self.mouse_dx = 0;
        self.mouse_dy = 0;
        self.fire = false;
        self.aim = false;
    }

    fn take_mouse_delta(&mut self) -> (i64, i64) {
        let result = (self.mouse_dx, self.mouse_dy);
        self.mouse_dx = 0;
        self.mouse_dy = 0;
        result
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputReadyEvent<'a> {
    r#type: &'static str,
    protocol_version: u8,
    backend: &'static str,
    session_id: &'a str,
    process_id: u32,
    target_hwnd: u64,
    parent_pid: u32,
    sample_hz: u32,
    clock_origin_unix_ns: String,
    clock_origin_monotonic_ns: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputSampleEvent<'a> {
    r#type: &'static str,
    protocol_version: u8,
    session_id: &'a str,
    sequence: u64,
    timestamp_ns: String,
    monotonic_ns: String,
    focused: bool,
    move_forward: bool,
    move_left: bool,
    move_backward: bool,
    move_right: bool,
    mouse_dx: i64,
    mouse_dy: i64,
    fire: bool,
    aim: bool,
    reload: bool,
    interact: bool,
    jump: bool,
    sprint: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputStoppedEvent<'a> {
    r#type: &'static str,
    protocol_version: u8,
    session_id: &'a str,
    sample_count: u64,
    focus_loss_count: u64,
}

pub(super) fn run(args: impl Iterator<Item = String>) -> Result<(), CaptureError> {
    let config = parse_args(args)?;
    let clock_origin_unix_ns = unix_timestamp_ns();
    let clock_origin = Instant::now();
    RAW_INPUT_STATE
        .set(Mutex::new(RawInputState {
            target_hwnd: config.hwnd,
            ..RawInputState::default()
        }))
        .map_err(|_| "Raw input recorder state was already initialized")?;

    start_stdin_watchdog(config.stop.clone());
    start_parent_watchdog(config.stop.clone(), config.parent_pid);
    let message_window = create_message_window()?;
    register_raw_input(message_window)?;

    write_event(&InputReadyEvent {
        r#type: "input_ready",
        protocol_version: INPUT_PROTOCOL_VERSION,
        backend: "windows_raw_input",
        session_id: &config.session_id,
        process_id: std::process::id(),
        target_hwnd: config.hwnd,
        parent_pid: config.parent_pid,
        sample_hz: config.sample_hz,
        clock_origin_unix_ns: clock_origin_unix_ns.to_string(),
        clock_origin_monotonic_ns: "0",
    })?;

    let interval = Duration::from_secs_f64(1.0 / f64::from(config.sample_hz));
    let mut next_sample_at = Instant::now();
    let mut sequence = 0_u64;
    let mut focus_loss_count = 0_u64;
    let mut was_focused = false;

    while !config.stop.load(Ordering::Acquire) {
        if pump_messages()? {
            break;
        }
        let now = Instant::now();
        if now >= next_sample_at {
            let focused = is_target_foreground(config.hwnd);
            let should_emit = focused || was_focused;
            if focused != was_focused {
                if !focused {
                    focus_loss_count += 1;
                }
                clear_raw_state();
            }
            if should_emit {
                sequence += 1;
                emit_sample(
                    &config.session_id,
                    sequence,
                    focused,
                    clock_origin,
                    clock_origin_unix_ns,
                )?;
            }
            was_focused = focused;

            // Preserve cadence without emitting a burst after scheduler stalls.
            next_sample_at += interval;
            if now.saturating_duration_since(next_sample_at) > interval * 2 {
                next_sample_at = now + interval;
            }
        }
        thread::sleep(Duration::from_millis(1));
    }

    clear_raw_state();
    unsafe {
        DestroyWindow(message_window)?;
    }
    write_event(&InputStoppedEvent {
        r#type: "input_stopped",
        protocol_version: INPUT_PROTOCOL_VERSION,
        session_id: &config.session_id,
        sample_count: sequence,
        focus_loss_count,
    })?;
    Ok(())
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<InputRecorderConfig, CaptureError> {
    let mut hwnd = None;
    let mut sample_hz = 120_u32;
    let mut session_id = None;
    let mut parent_pid = None;
    let mut args = args.peekable();
    while let Some(argument) = args.next() {
        let value = match argument.as_str() {
            "--hwnd" | "--sample-hz" | "--session-id" | "--parent-pid" => args
                .next()
                .ok_or_else(|| format!("Missing value for {argument}"))?,
            _ => return Err(format!("Unknown input recorder argument: {argument}").into()),
        };
        match argument.as_str() {
            "--hwnd" => hwnd = Some(value.parse::<u64>()?),
            "--sample-hz" => sample_hz = value.parse::<u32>()?,
            "--session-id" => session_id = Some(value),
            "--parent-pid" => parent_pid = Some(value.parse::<u32>()?),
            _ => unreachable!(),
        }
    }
    if !(MIN_SAMPLE_HZ..=MAX_SAMPLE_HZ).contains(&sample_hz) {
        return Err(
            format!("--sample-hz must be between {MIN_SAMPLE_HZ} and {MAX_SAMPLE_HZ}").into(),
        );
    }
    Ok(InputRecorderConfig {
        hwnd: hwnd.ok_or("--hwnd is required for input recording")?,
        sample_hz,
        session_id: session_id.ok_or("--session-id is required for input recording")?,
        parent_pid: parent_pid.ok_or("--parent-pid is required for input recording")?,
        stop: Arc::new(AtomicBool::new(false)),
    })
}

fn create_message_window() -> Result<HWND, CaptureError> {
    let module = unsafe { GetModuleHandleW(None)? };
    let instance = HINSTANCE(module.0);
    let class_name: PCWSTR = w!("LeviathanHumanInputRecorderWindow");
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    if unsafe { RegisterClassW(&window_class) } == 0 {
        return Err(WindowsError::from_thread().into());
    }
    Ok(unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("Leviathan Human Input Recorder"),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        )?
    })
}

fn register_raw_input(message_window: HWND) -> Result<(), CaptureError> {
    let devices = [
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: message_window,
        },
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: message_window,
        },
    ];
    unsafe { RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32)? };
    Ok(())
}

fn pump_messages() -> Result<bool, CaptureError> {
    let mut message = MSG::default();
    loop {
        let available = unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool();
        if !available {
            return Ok(false);
        }
        if message.message == WM_QUIT {
            return Ok(true);
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_INPUT => {
            process_raw_input(HRAWINPUT(lparam.0 as *mut c_void));
            LRESULT(0)
        }
        WM_DESTROY => LRESULT(0),
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

fn process_raw_input(handle: HRAWINPUT) {
    let Some(state_lock) = RAW_INPUT_STATE.get() else {
        return;
    };
    let target_hwnd = match state_lock.lock() {
        Ok(state) => state.target_hwnd,
        Err(_) => return,
    };
    if !is_target_foreground(target_hwnd) {
        clear_raw_state();
        return;
    }

    let mut byte_count = 0_u32;
    let header_size = size_of::<RAWINPUTHEADER>() as u32;
    let query = unsafe { GetRawInputData(handle, RID_INPUT, None, &mut byte_count, header_size) };
    if query == u32::MAX || byte_count < size_of::<RAWINPUT>() as u32 {
        return;
    }
    let word_size = size_of::<usize>();
    let mut storage = vec![0_usize; (byte_count as usize).div_ceil(word_size)];
    let read = unsafe {
        GetRawInputData(
            handle,
            RID_INPUT,
            Some(storage.as_mut_ptr().cast::<c_void>()),
            &mut byte_count,
            header_size,
        )
    };
    if read == u32::MAX || read < size_of::<RAWINPUTHEADER>() as u32 {
        return;
    }
    let raw = unsafe { &*(storage.as_ptr().cast::<RAWINPUT>()) };
    let Ok(mut state) = state_lock.lock() else {
        return;
    };
    if raw.header.dwType == RIM_TYPEMOUSE.0 {
        let mouse = unsafe { raw.data.mouse };
        state.mouse_dx = state.mouse_dx.saturating_add(i64::from(mouse.lLastX));
        state.mouse_dy = state.mouse_dy.saturating_add(i64::from(mouse.lLastY));
        let button_flags = u32::from(unsafe { mouse.Anonymous.Anonymous.usButtonFlags });
        if button_flags & RI_MOUSE_LEFT_BUTTON_DOWN != 0 {
            state.fire = true;
        }
        if button_flags & RI_MOUSE_LEFT_BUTTON_UP != 0 {
            state.fire = false;
        }
        if button_flags & RI_MOUSE_RIGHT_BUTTON_DOWN != 0 {
            state.aim = true;
        }
        if button_flags & RI_MOUSE_RIGHT_BUTTON_UP != 0 {
            state.aim = false;
        }
    } else if raw.header.dwType == RIM_TYPEKEYBOARD.0 {
        let keyboard = unsafe { raw.data.keyboard };
        let Some(mask) = key_mask(keyboard.VKey) else {
            return;
        };
        if u32::from(keyboard.Flags) & RI_KEY_BREAK != 0 {
            state.keys &= !mask;
        } else {
            state.keys |= mask;
        }
    }
}

fn key_mask(vkey: u16) -> Option<u32> {
    match vkey {
        0x57 => Some(KEY_W),
        0x41 => Some(KEY_A),
        0x53 => Some(KEY_S),
        0x44 => Some(KEY_D),
        0x52 => Some(KEY_R),
        0x45 => Some(KEY_E),
        value if value == VK_SPACE.0 => Some(KEY_SPACE),
        value if value == VK_SHIFT.0 || value == VK_LSHIFT.0 || value == VK_RSHIFT.0 => {
            Some(KEY_SHIFT)
        }
        _ => None,
    }
}

fn emit_sample(
    session_id: &str,
    sequence: u64,
    focused: bool,
    clock_origin: Instant,
    clock_origin_unix_ns: u128,
) -> Result<(), CaptureError> {
    let elapsed_ns = clock_origin.elapsed().as_nanos();
    let timestamp_ns = clock_origin_unix_ns.saturating_add(elapsed_ns);
    let mut snapshot = RAW_INPUT_STATE
        .get()
        .ok_or("Raw input recorder state is unavailable")?
        .lock()
        .map_err(|_| "Raw input recorder state is poisoned")?;
    if !focused {
        snapshot.clear();
    }
    let (mouse_dx, mouse_dy) = snapshot.take_mouse_delta();
    let keys = snapshot.keys;
    write_event(&InputSampleEvent {
        r#type: "input_sample",
        protocol_version: INPUT_PROTOCOL_VERSION,
        session_id,
        sequence,
        timestamp_ns: timestamp_ns.to_string(),
        monotonic_ns: elapsed_ns.to_string(),
        focused,
        move_forward: focused && keys & KEY_W != 0,
        move_left: focused && keys & KEY_A != 0,
        move_backward: focused && keys & KEY_S != 0,
        move_right: focused && keys & KEY_D != 0,
        mouse_dx: if focused { mouse_dx } else { 0 },
        mouse_dy: if focused { mouse_dy } else { 0 },
        fire: focused && snapshot.fire,
        aim: focused && snapshot.aim,
        reload: focused && keys & KEY_R != 0,
        interact: focused && keys & KEY_E != 0,
        jump: focused && keys & KEY_SPACE != 0,
        sprint: focused && keys & KEY_SHIFT != 0,
    })
}

fn clear_raw_state() {
    if let Some(state) = RAW_INPUT_STATE.get()
        && let Ok(mut state) = state.lock()
    {
        state.clear();
    }
}

fn is_target_foreground(target_hwnd: u64) -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    foreground.0 as usize as u64 == target_hwnd
}

fn unix_timestamp_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn write_event(event: &impl Serialize) -> Result<(), CaptureError> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, event)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{KEY_A, KEY_SHIFT, KEY_SPACE, KEY_W, key_mask, parse_args};

    #[test]
    fn parses_required_input_recorder_arguments() {
        let config = parse_args(
            [
                "--hwnd",
                "42",
                "--sample-hz",
                "120",
                "--session-id",
                "session-1",
                "--parent-pid",
                "99",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .expect("valid recorder config");
        assert_eq!(config.hwnd, 42);
        assert_eq!(config.sample_hz, 120);
        assert_eq!(config.session_id, "session-1");
        assert_eq!(config.parent_pid, 99);
    }

    #[test]
    fn maps_training_action_keys_to_stable_bits() {
        assert_eq!(key_mask(0x57), Some(KEY_W));
        assert_eq!(key_mask(0x41), Some(KEY_A));
        assert_eq!(key_mask(0x20), Some(KEY_SPACE));
        assert_eq!(key_mask(0x10), Some(KEY_SHIFT));
        assert_eq!(key_mask(0x70), None);
    }
}
