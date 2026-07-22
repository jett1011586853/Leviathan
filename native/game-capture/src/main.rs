use std::error::Error;
use std::ffi::c_void;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, ImageEncoder, ImageEncoderPixelFormat,
    ImageFormat, VideoEncoder, VideoSettingsBuilder,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

mod input_recorder;

const PROTOCOL_VERSION: u8 = 1;
const THUMBNAIL_WIDTH: usize = 32;
const THUMBNAIL_HEIGHT: usize = 18;
const MOTION_GRID_COLUMNS: usize = 4;
const MOTION_GRID_ROWS: usize = 3;

type CaptureError = Box<dyn Error + Send + Sync>;

#[derive(Clone, Debug)]
struct CaptureConfig {
    hwnd: u64,
    target_fps: u32,
    session_id: String,
    adapter_instance_id: String,
    parent_pid: u32,
    record_path: Option<PathBuf>,
    sample_dir: Option<PathBuf>,
    sample_fps: u32,
    stop: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyEvent<'a> {
    r#type: &'static str,
    protocol_version: u8,
    backend: &'static str,
    session_id: &'a str,
    adapter_instance_id: &'a str,
    process_id: u32,
    hwnd: u64,
    target_fps: u32,
    parent_pid: u32,
    recording_path: Option<String>,
    sample_directory: Option<String>,
    sample_fps: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameEvent<'a> {
    r#type: &'static str,
    protocol_version: u8,
    session_id: &'a str,
    adapter_instance_id: &'a str,
    sequence: u64,
    captured_at: u64,
    width: u32,
    height: u32,
    frame_sha256: String,
    motion_score: f64,
    motion_grid_columns: usize,
    motion_grid_rows: usize,
    motion_grid: Vec<f64>,
    mean_luma: f64,
    luma_std_dev: f64,
    black_frame_probability: f64,
    measured_fps: f64,
    processing_ms: f64,
    sample_path: Option<String>,
    sample_sha256: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleEvent<'a> {
    r#type: &'static str,
    protocol_version: u8,
    session_id: &'a str,
    adapter_instance_id: &'a str,
    sequence: u64,
    captured_frames: u64,
    sampled_frames: u64,
    recording_path: Option<String>,
}

struct CaptureHandler {
    config: CaptureConfig,
    encoder: Option<VideoEncoder>,
    previous_luma: Option<Vec<u8>>,
    sequence: u64,
    captured_frames: u64,
    started_at: Instant,
    fps_window_started_at: Instant,
    fps_window_frames: u64,
    measured_fps: f64,
    sampled_frames: u64,
    last_sample_at: Option<Instant>,
    stopped_event_written: bool,
}

impl CaptureHandler {
    fn ensure_encoder(&mut self, width: u32, height: u32) -> Result<(), CaptureError> {
        if self.encoder.is_some() || self.config.record_path.is_none() {
            return Ok(());
        }
        let path = self
            .config
            .record_path
            .as_ref()
            .expect("record path checked");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let video = VideoSettingsBuilder::new(width, height)
            .frame_rate(self.config.target_fps)
            .bitrate(20_000_000);
        self.encoder = Some(VideoEncoder::new(
            video,
            AudioSettingsBuilder::default().disabled(true),
            ContainerSettingsBuilder::default(),
            path,
        )?);
        Ok(())
    }

    fn finish_recording(&mut self) -> Result<(), CaptureError> {
        if let Some(encoder) = self.encoder.take() {
            encoder.finish()?;
        }
        Ok(())
    }

    fn write_stopped_event(&mut self) -> Result<(), CaptureError> {
        if self.stopped_event_written {
            return Ok(());
        }
        self.stopped_event_written = true;
        write_event(&LifecycleEvent {
            r#type: "stopped",
            protocol_version: PROTOCOL_VERSION,
            session_id: &self.config.session_id,
            adapter_instance_id: &self.config.adapter_instance_id,
            sequence: self.sequence,
            captured_frames: self.captured_frames,
            sampled_frames: self.sampled_frames,
            recording_path: self
                .config
                .record_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
        })?;
        Ok(())
    }
}

impl GraphicsCaptureApiHandler for CaptureHandler {
    type Flags = CaptureConfig;
    type Error = CaptureError;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        write_event(&ReadyEvent {
            r#type: "ready",
            protocol_version: PROTOCOL_VERSION,
            backend: "windows_graphics_capture",
            session_id: &ctx.flags.session_id,
            adapter_instance_id: &ctx.flags.adapter_instance_id,
            process_id: std::process::id(),
            hwnd: ctx.flags.hwnd,
            target_fps: ctx.flags.target_fps,
            parent_pid: ctx.flags.parent_pid,
            recording_path: ctx
                .flags
                .record_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            sample_directory: ctx
                .flags
                .sample_dir
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            sample_fps: ctx.flags.sample_fps,
        })?;
        let now = Instant::now();
        Ok(Self {
            config: ctx.flags,
            encoder: None,
            previous_luma: None,
            sequence: 0,
            captured_frames: 0,
            started_at: now,
            fps_window_started_at: now,
            fps_window_frames: 0,
            measured_fps: 0.0,
            sampled_frames: 0,
            last_sample_at: None,
            stopped_event_written: false,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.config.stop.load(Ordering::Acquire) {
            self.finish_recording()?;
            self.write_stopped_event()?;
            capture_control.stop();
            return Ok(());
        }

        let captured_at = unix_timestamp_ms();
        let processing_started_at = Instant::now();
        self.ensure_encoder(frame.width(), frame.height())?;
        if let Some(encoder) = self.encoder.as_mut() {
            encoder.send_frame(frame)?;
        }

        self.sequence += 1;
        self.captured_frames += 1;
        let (
            width,
            height,
            frame_sha256,
            mean_luma,
            luma_std_dev,
            motion_score,
            motion_grid,
            black_frame_probability,
            sample_path,
            sample_sha256,
        ) = {
            let mut frame_buffer = frame.buffer()?;
            let width = frame_buffer.width();
            let height = frame_buffer.height();
            let row_pitch = frame_buffer.row_pitch() as usize;
            let raw = frame_buffer.as_raw_buffer();
            let frame_sha256 = hex::encode(Sha256::digest(&*raw));
            let luma = downsample_luma(raw, width, height, row_pitch);
            let (mean_luma, luma_std_dev) = luma_statistics(&luma);
            let motion_score = motion_score(self.previous_luma.as_deref(), &luma);
            let motion_grid = motion_grid(self.previous_luma.as_deref(), &luma);
            let black_frame_probability = black_frame_probability(mean_luma, luma_std_dev);
            let (sample_path, sample_sha256) =
                self.write_dataset_sample(raw, width, height, row_pitch)?;
            self.previous_luma = Some(luma);
            (
                width,
                height,
                frame_sha256,
                mean_luma,
                luma_std_dev,
                motion_score,
                motion_grid,
                black_frame_probability,
                sample_path,
                sample_sha256,
            )
        };

        self.fps_window_frames += 1;
        let fps_elapsed = self.fps_window_started_at.elapsed();
        if fps_elapsed >= Duration::from_millis(500) {
            self.measured_fps = self.fps_window_frames as f64 / fps_elapsed.as_secs_f64();
            self.fps_window_frames = 0;
            self.fps_window_started_at = Instant::now();
        } else if self.measured_fps == 0.0 {
            let total_elapsed = self.started_at.elapsed().as_secs_f64();
            if total_elapsed > 0.0 {
                self.measured_fps = self.captured_frames as f64 / total_elapsed;
            }
        }

        write_event(&FrameEvent {
            r#type: "frame",
            protocol_version: PROTOCOL_VERSION,
            session_id: &self.config.session_id,
            adapter_instance_id: &self.config.adapter_instance_id,
            sequence: self.sequence,
            captured_at,
            width,
            height,
            frame_sha256,
            motion_score: round4(motion_score),
            motion_grid_columns: MOTION_GRID_COLUMNS,
            motion_grid_rows: MOTION_GRID_ROWS,
            motion_grid: motion_grid.into_iter().map(round4).collect(),
            mean_luma: round4(mean_luma),
            luma_std_dev: round4(luma_std_dev),
            black_frame_probability: round4(black_frame_probability),
            measured_fps: round2(self.measured_fps),
            processing_ms: round2(processing_started_at.elapsed().as_secs_f64() * 1000.0),
            sample_path,
            sample_sha256,
        })?;
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.finish_recording()?;
        self.write_stopped_event()?;
        Ok(())
    }
}

impl CaptureHandler {
    fn write_dataset_sample(
        &mut self,
        raw: &[u8],
        width: u32,
        height: u32,
        row_pitch: usize,
    ) -> Result<(Option<String>, Option<String>), CaptureError> {
        let Some(sample_dir) = self.config.sample_dir.as_ref() else {
            return Ok((None, None));
        };
        if self.config.sample_fps == 0 {
            return Ok((None, None));
        }
        let now = Instant::now();
        let interval = Duration::from_secs_f64(1.0 / f64::from(self.config.sample_fps));
        if self
            .last_sample_at
            .is_some_and(|last_sample| now.duration_since(last_sample) < interval)
        {
            return Ok((None, None));
        }
        self.last_sample_at = Some(now);
        std::fs::create_dir_all(sample_dir)?;
        let path = sample_dir.join(format!("{:08}.jpg", self.sequence));
        let row_bytes = width as usize * 4;
        let required_bytes = row_pitch
            .checked_mul(height as usize)
            .ok_or("Frame dimensions exceed the supported sample buffer size")?;
        if row_pitch < row_bytes || raw.len() < required_bytes {
            return Err("Frame buffer is smaller than its declared dimensions".into());
        }
        let packed;
        let pixels = if row_pitch == row_bytes {
            &raw[..row_bytes * height as usize]
        } else {
            packed = pack_bgra_rows(raw, row_bytes, row_pitch, height as usize);
            packed.as_slice()
        };
        let encoded = ImageEncoder::new(ImageFormat::Jpeg, ImageEncoderPixelFormat::Bgra8)?
            .encode(pixels, width, height)?;
        let encoded_sha256 = hex::encode(Sha256::digest(&encoded));
        std::fs::write(&path, encoded)?;
        self.sampled_frames += 1;
        Ok((
            Some(path.to_string_lossy().into_owned()),
            Some(encoded_sha256),
        ))
    }
}

fn pack_bgra_rows(raw: &[u8], row_bytes: usize, row_pitch: usize, height: usize) -> Vec<u8> {
    let mut packed = Vec::with_capacity(row_bytes * height);
    for row in 0..height {
        let start = row * row_pitch;
        packed.extend_from_slice(&raw[start..start + row_bytes]);
    }
    packed
}

fn main() -> Result<(), CaptureError> {
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().is_some_and(|value| value == "--input-recorder") {
        args.next();
        return input_recorder::run(args);
    }
    let config = parse_args(args)?;
    let stop = config.stop.clone();
    start_stdin_watchdog(config.stop.clone());
    start_parent_watchdog(config.stop.clone(), config.parent_pid);
    let window = Window::from_raw_hwnd(config.hwnd as usize as *mut c_void);
    if !window.is_valid() {
        return Err(format!("HWND {} is not a capturable top-level window", config.hwnd).into());
    }
    let interval_micros = 1_000_000_u64 / u64::from(config.target_fps);
    let settings = Settings::new(
        window,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Exclude,
        MinimumUpdateIntervalSettings::Custom(Duration::from_micros(interval_micros)),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        config,
    );
    let control = CaptureHandler::start_free_threaded(settings)?;
    while !stop.load(Ordering::Acquire) && !control.is_finished() {
        thread::sleep(Duration::from_millis(25));
    }
    if control.is_finished() {
        control.wait()?;
        return Ok(());
    }
    {
        let callback = control.callback();
        let mut handler = callback.lock();
        handler.finish_recording()?;
        handler.write_stopped_event()?;
    }
    control.stop()?;
    Ok(())
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<CaptureConfig, CaptureError> {
    let mut hwnd = None;
    let mut target_fps = 60_u32;
    let mut session_id = None;
    let mut adapter_instance_id = None;
    let mut parent_pid = None;
    let mut record_path = None;
    let mut sample_dir = None;
    let mut sample_fps = 0_u32;
    let mut args = args.peekable();
    while let Some(argument) = args.next() {
        let value = match argument.as_str() {
            "--hwnd"
            | "--target-fps"
            | "--session-id"
            | "--adapter-instance-id"
            | "--parent-pid"
            | "--record-path"
            | "--sample-dir"
            | "--sample-fps" => args
                .next()
                .ok_or_else(|| format!("Missing value for {argument}"))?,
            _ => return Err(format!("Unknown argument: {argument}").into()),
        };
        match argument.as_str() {
            "--hwnd" => hwnd = Some(value.parse::<u64>()?),
            "--target-fps" => target_fps = value.parse::<u32>()?,
            "--session-id" => session_id = Some(value),
            "--adapter-instance-id" => adapter_instance_id = Some(value),
            "--parent-pid" => parent_pid = Some(value.parse::<u32>()?),
            "--record-path" => record_path = Some(PathBuf::from(value)),
            "--sample-dir" => sample_dir = Some(PathBuf::from(value)),
            "--sample-fps" => sample_fps = value.parse::<u32>()?,
            _ => unreachable!(),
        }
    }
    if !(1..=120).contains(&target_fps) {
        return Err("--target-fps must be between 1 and 120".into());
    }
    if sample_fps > 30 || sample_fps > target_fps {
        return Err("--sample-fps must be between 0 and 30 and no greater than target FPS".into());
    }
    if sample_fps > 0 && sample_dir.is_none() {
        return Err("--sample-dir is required when --sample-fps is greater than 0".into());
    }
    Ok(CaptureConfig {
        hwnd: hwnd.ok_or("--hwnd is required")?,
        target_fps,
        session_id: session_id.ok_or("--session-id is required")?,
        adapter_instance_id: adapter_instance_id.ok_or("--adapter-instance-id is required")?,
        parent_pid: parent_pid.ok_or("--parent-pid is required")?,
        record_path,
        sample_dir,
        sample_fps,
        stop: Arc::new(AtomicBool::new(false)),
    })
}

fn start_stdin_watchdog(stop: Arc<AtomicBool>) {
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(value) if value.trim().eq_ignore_ascii_case("stop") => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
        stop.store(true, Ordering::Release);
    });
}

fn start_parent_watchdog(stop: Arc<AtomicBool>, parent_pid: u32) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(1));
            if is_process_alive(parent_pid) {
                continue;
            }
            stop.store(true, Ordering::Release);
            // Give an active frame callback a chance to finalize its encoder. If
            // the source is no longer producing frames, force termination so the
            // capture process cannot outlive its Sidecar.
            thread::sleep(Duration::from_secs(2));
            if !is_process_alive(parent_pid) {
                std::process::exit(0);
            }
        }
    });
}

fn is_process_alive(pid: u32) -> bool {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut exit_code = 0_u32;
        let alive = GetExitCodeProcess(handle, &mut exit_code).is_ok()
            && exit_code == STILL_ACTIVE.0 as u32;
        let _ = CloseHandle(handle);
        alive
    }
}

fn downsample_luma(raw: &[u8], width: u32, height: u32, row_pitch: usize) -> Vec<u8> {
    let mut output = vec![0_u8; THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT];
    for output_y in 0..THUMBNAIL_HEIGHT {
        let source_y = output_y * height as usize / THUMBNAIL_HEIGHT;
        for output_x in 0..THUMBNAIL_WIDTH {
            let source_x = output_x * width as usize / THUMBNAIL_WIDTH;
            let index = source_y * row_pitch + source_x * 4;
            if index + 2 >= raw.len() {
                continue;
            }
            let blue = u32::from(raw[index]);
            let green = u32::from(raw[index + 1]);
            let red = u32::from(raw[index + 2]);
            output[output_y * THUMBNAIL_WIDTH + output_x] =
                ((29 * blue + 150 * green + 77 * red) >> 8) as u8;
        }
    }
    output
}

fn luma_statistics(luma: &[u8]) -> (f64, f64) {
    if luma.is_empty() {
        return (0.0, 0.0);
    }
    let count = luma.len() as f64;
    let mean = luma.iter().map(|value| f64::from(*value)).sum::<f64>() / count;
    let variance = luma
        .iter()
        .map(|value| {
            let delta = f64::from(*value) - mean;
            delta * delta
        })
        .sum::<f64>()
        / count;
    (mean / 255.0, variance.sqrt() / 255.0)
}

fn motion_score(previous: Option<&[u8]>, current: &[u8]) -> f64 {
    let Some(previous) = previous else {
        return 0.0;
    };
    if previous.len() != current.len() || current.is_empty() {
        return 0.0;
    }
    previous
        .iter()
        .zip(current)
        .map(|(left, right)| (i32::from(*left) - i32::from(*right)).unsigned_abs() as f64)
        .sum::<f64>()
        / current.len() as f64
        / 255.0
}

fn motion_grid(previous: Option<&[u8]>, current: &[u8]) -> Vec<f64> {
    let mut output = vec![0.0; MOTION_GRID_COLUMNS * MOTION_GRID_ROWS];
    let Some(previous) = previous else {
        return output;
    };
    if previous.len() != current.len() {
        return output;
    }
    for row in 0..MOTION_GRID_ROWS {
        let start_y = row * THUMBNAIL_HEIGHT / MOTION_GRID_ROWS;
        let end_y = (row + 1) * THUMBNAIL_HEIGHT / MOTION_GRID_ROWS;
        for column in 0..MOTION_GRID_COLUMNS {
            let start_x = column * THUMBNAIL_WIDTH / MOTION_GRID_COLUMNS;
            let end_x = (column + 1) * THUMBNAIL_WIDTH / MOTION_GRID_COLUMNS;
            let mut total = 0.0;
            let mut count = 0_usize;
            for y in start_y..end_y {
                for x in start_x..end_x {
                    let index = y * THUMBNAIL_WIDTH + x;
                    total += (i32::from(previous[index]) - i32::from(current[index])).unsigned_abs()
                        as f64;
                    count += 1;
                }
            }
            output[row * MOTION_GRID_COLUMNS + column] = if count == 0 {
                0.0
            } else {
                total / count as f64 / 255.0
            };
        }
    }
    output
}

fn black_frame_probability(mean_luma: f64, luma_std_dev: f64) -> f64 {
    let darkness = ((0.08 - mean_luma) / 0.08).clamp(0.0, 1.0);
    let flatness = ((0.03 - luma_std_dev) / 0.03).clamp(0.0, 1.0);
    darkness * flatness
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
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
    use super::pack_bgra_rows;

    #[test]
    fn removes_row_padding_from_dataset_samples() {
        let raw = [1, 2, 3, 4, 5, 6, 99, 99, 7, 8, 9, 10, 11, 12, 99, 99];
        assert_eq!(
            pack_bgra_rows(&raw, 6, 8, 2),
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        );
    }
}
