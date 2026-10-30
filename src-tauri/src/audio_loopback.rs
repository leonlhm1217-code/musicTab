use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, SupportedStreamConfig};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::f32::consts::PI;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const FFT_SIZE: usize = 1024;
const NUM_SPECTRUM_BANDS: usize = 32;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTelemetryPayload {
    pub rms_volume: f32,
    pub db_level: i32,
    pub bass_energy: f32,
    pub mid_energy: f32,
    pub treble_energy: f32,
    pub dominant_pitch_hz: u32,
    pub is_beat: bool,
    pub waveform_slice: Vec<f32>,
    pub spectrum_bands: Vec<f32>,
    pub device_name: String,
}

impl AudioTelemetryPayload {
    fn silent(device_name: &str) -> Self {
        Self {
            rms_volume: 0.0,
            db_level: -60,
            bass_energy: 0.0,
            mid_energy: 0.0,
            treble_energy: 0.0,
            dominant_pitch_hz: 0,
            is_beat: false,
            waveform_slice: vec![0.0; 48],
            spectrum_bands: vec![0.0; NUM_SPECTRUM_BANDS],
            device_name: device_name.to_string(),
        }
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_millis(0))
        .as_millis() as u64
}

struct DspState {
    ring_buffer: Vec<f32>,
    hann_window: Vec<f32>,
    prev_bass: f32,
    beat_cooldown: u32,
    smooth_pitch: f32,
    smoothed_bands: [f32; NUM_SPECTRUM_BANDS],
}

impl DspState {
    fn new() -> Self {
        let hann_window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * (i as f32) / ((FFT_SIZE - 1) as f32)).cos()))
            .collect();

        Self {
            ring_buffer: Vec::with_capacity(FFT_SIZE * 2),
            hann_window,
            prev_bass: 0.0,
            beat_cooldown: 0,
            smooth_pitch: 0.0,
            smoothed_bands: [0.0; NUM_SPECTRUM_BANDS],
        }
    }

    fn reset_on_silence(&mut self) {
        self.ring_buffer.clear();
        self.prev_bass = 0.0;
        self.beat_cooldown = 0;
        self.smooth_pitch = 0.0;
        self.smoothed_bands = [0.0; NUM_SPECTRUM_BANDS];
    }

    fn process_block(
        &mut self,
        samples: &[f32],
        sample_rate: f32,
        device_name: &str,
    ) -> AudioTelemetryPayload {
        // 1. Time-domain RMS & 48-point downsampled waveform slice
        let mut sum_sq = 0.0_f32;
        for &s in samples {
            sum_sq += s * s;
        }
        let rms_raw = (sum_sq / (samples.len() as f32)).sqrt();

        let step = (samples.len() / 48).max(1);
        let waveform_slice: Vec<f32> = samples
            .iter()
            .step_by(step)
            .take(48)
            .map(|&v| v.clamp(-1.0, 1.0))
            .collect();

        // 2. Apply Hann window & run 1024-point FFT
        let mut buffer: Vec<Complex<f32>> = samples
            .iter()
            .zip(self.hann_window.iter())
            .map(|(&s, &w)| Complex {
                re: s * w,
                im: 0.0,
            })
            .collect();

        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        fft.process(&mut buffer);

        let half_bins = FFT_SIZE / 2;
        let hz_per_bin = sample_rate / (FFT_SIZE as f32);
        let norm_factor = (FFT_SIZE as f32) * 0.25;

        let mut low_sum = 0.0_f32;
        let mut low_cnt = 0_u32;
        let mut mid_sum = 0.0_f32;
        let mut mid_cnt = 0_u32;
        let mut high_sum = 0.0_f32;
        let mut high_cnt = 0_u32;

        let mut max_mag = 0.0_f32;
        let mut max_bin = 0_usize;

        let mut magnitudes = vec![0.0_f32; half_bins];
        for i in 1..half_bins {
            let freq = (i as f32) * hz_per_bin;
            let mag = buffer[i].norm() / norm_factor;
            magnitudes[i] = mag;

            if (20.0..=250.0).contains(&freq) {
                low_sum += mag;
                low_cnt += 1;
            } else if (250.0..=2500.0).contains(&freq) {
                mid_sum += mag;
                mid_cnt += 1;
            } else if (2500.0..=14000.0).contains(&freq) {
                high_sum += mag;
                high_cnt += 1;
            }

            if (65.0..=2400.0).contains(&freq) && mag > max_mag {
                max_mag = mag;
                max_bin = i;
            }
        }

        // 3. Extract 32 Logarithmic Frequency Bands (32 Hz to 16,000 Hz) with Car Stereo Equalizer Tilt
        let min_f = 32.0_f32;
        let max_f = 16000.0_f32;
        let ratio = max_f / min_f;
        let mut spectrum_bands = Vec::with_capacity(NUM_SPECTRUM_BANDS);

        for b in 0..NUM_SPECTRUM_BANDS {
            let t0 = (b as f32) / (NUM_SPECTRUM_BANDS as f32);
            let t1 = ((b + 1) as f32) / (NUM_SPECTRUM_BANDS as f32);
            let f0 = min_f * ratio.powf(t0);
            let f1 = min_f * ratio.powf(t1);

            let idx0 = ((f0 / hz_per_bin).floor() as usize).clamp(1, half_bins - 1);
            let idx1 = ((f1 / hz_per_bin).ceil() as usize).clamp(idx0, half_bins - 1);

            let mut band_peak = 0.0_f32;
            let mut band_sum = 0.0_f32;
            let count = (idx1 - idx0 + 1).max(1) as f32;
            for &m in &magnitudes[idx0..=idx1] {
                if m > band_peak {
                    band_peak = m;
                }
                band_sum += m;
            }
            let band_avg = (band_peak * 0.65) + (band_sum / count) * 0.35;

            // Perceptual loudness tilt so mid/high frequencies dance as vividly as bass drums
            let freq_tilt = 16.0 + (b as f32) * 3.1;
            let raw_val = (band_avg * freq_tilt).powf(0.75).clamp(0.0, 1.0);

            // Fast attack (0.72), crisp automotive VFD decay (0.58)
            let prev = self.smoothed_bands[b];
            let next = if raw_val > prev {
                prev * 0.28 + raw_val * 0.72
            } else {
                prev * 0.58 + raw_val * 0.42
            };
            self.smoothed_bands[b] = if next < 0.015 { 0.0 } else { next };
            spectrum_bands.push(self.smoothed_bands[b]);
        }

        let bass_energy = if low_cnt > 0 {
            ((low_sum / (low_cnt as f32)) * 18.0).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let mid_energy = if mid_cnt > 0 {
            ((mid_sum / (mid_cnt as f32)) * 38.0).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let treble_energy = if high_cnt > 0 {
            ((high_sum / (high_cnt as f32)) * 85.0).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let energy_blend = bass_energy * 0.42 + mid_energy * 0.38 + treble_energy * 0.20;
        let rms_volume = (rms_raw * 3.2).max(energy_blend).clamp(0.0, 1.0);
        let db_level = if rms_volume > 0.0005 {
            (20.0 * rms_volume.log10()).round().max(-60.0) as i32
        } else {
            -60
        };

        // 4. Dominant Pitch (Hz) estimation
        if max_mag > 0.004 {
            let raw_pitch = (max_bin as f32) * hz_per_bin;
            self.smooth_pitch = if self.smooth_pitch == 0.0 {
                raw_pitch
            } else {
                self.smooth_pitch * 0.78 + raw_pitch * 0.22
            };
        } else {
            self.smooth_pitch *= 0.92;
        }
        let dominant_pitch_hz = if self.smooth_pitch > 35.0 {
            self.smooth_pitch.round() as u32
        } else {
            0
        };

        // 5. Onset Beat Detection
        let bass_delta = bass_energy - self.prev_bass;
        self.prev_bass = bass_energy * 0.65 + self.prev_bass * 0.35;
        if self.beat_cooldown > 0 {
            self.beat_cooldown -= 1;
        }
        let is_beat = bass_delta > 0.085 && bass_energy > 0.20 && self.beat_cooldown == 0;
        if is_beat {
            self.beat_cooldown = 8;
        }

        AudioTelemetryPayload {
            rms_volume,
            db_level,
            bass_energy,
            mid_energy,
            treble_energy,
            dominant_pitch_hz,
            is_beat,
            waveform_slice,
            spectrum_bands,
            device_name: device_name.to_string(),
        }
    }
}

/// STRICT ZERO-MICROPHONE POLICY:
/// Exclusively queries `host.default_output_device()` (system speaker / headphone output WASAPI Loopback).
/// NEVER queries or opens `default_input_device()` (microphones are 100% physically untouched).
fn select_output_only_loopback_device(
    host: &cpal::Host,
) -> Option<(Device, SupportedStreamConfig, String)> {
    if let Some(out_dev) = host.default_output_device() {
        if let Ok(cfg) = out_dev.default_output_config() {
            let name = out_dev
                .name()
                .unwrap_or_else(|_| "System Output Loopback".to_string());
            return Some((out_dev, cfg, name));
        }
    }
    None
}

pub fn spawn_soundcard_loopback(app: AppHandle) {
    std::thread::spawn(move || {
        let state = Arc::new(Mutex::new(DspState::new()));

        loop {
            let host = cpal::default_host();
            let Some((device, config, active_device_name)) =
                select_output_only_loopback_device(&host)
            else {
                let _ = app.emit(
                    "audio-telemetry",
                    AudioTelemetryPayload::silent("等待播放设备接入"),
                );
                std::thread::sleep(Duration::from_secs(2));
                continue;
            };

            let sample_rate = config.sample_rate().0 as f32;
            let channels = config.channels() as usize;
            let sample_format = config.sample_format();
            let stream_config: cpal::StreamConfig = config.into();

            let stream_broken = Arc::new(AtomicBool::new(false));
            let last_callback_ms = Arc::new(AtomicU64::new(now_epoch_ms()));

            let stream_result = match sample_format {
                SampleFormat::F32 => {
                    let state_ref = state.clone();
                    let app_ref = app.clone();
                    let dev_name_for_cb = active_device_name.clone();
                    let broken_for_err = stream_broken.clone();
                    let cb_time_ref = last_callback_ms.clone();
                    device.build_input_stream(
                        &stream_config,
                        move |data: &[f32], _| {
                            cb_time_ref.store(now_epoch_ms(), Ordering::Relaxed);
                            push_and_emit(
                                data,
                                channels,
                                sample_rate,
                                &dev_name_for_cb,
                                &state_ref,
                                &app_ref,
                            );
                        },
                        move |err| {
                            eprintln!("[AuraLine Output Loopback] 播放设备切换，准备自动重连: {}", err);
                            broken_for_err.store(true, Ordering::SeqCst);
                        },
                        None,
                    )
                }
                SampleFormat::I16 => {
                    let state_ref = state.clone();
                    let app_ref = app.clone();
                    let dev_name_for_cb = active_device_name.clone();
                    let broken_for_err = stream_broken.clone();
                    let cb_time_ref = last_callback_ms.clone();
                    device.build_input_stream(
                        &stream_config,
                        move |data: &[i16], _| {
                            cb_time_ref.store(now_epoch_ms(), Ordering::Relaxed);
                            let converted: Vec<f32> =
                                data.iter().map(|&s| (s as f32) / 32768.0).collect();
                            push_and_emit(
                                &converted,
                                channels,
                                sample_rate,
                                &dev_name_for_cb,
                                &state_ref,
                                &app_ref,
                            );
                        },
                        move |err| {
                            eprintln!("[AuraLine Output Loopback] 播放设备切换，准备自动重连: {}", err);
                            broken_for_err.store(true, Ordering::SeqCst);
                        },
                        None,
                    )
                }
                SampleFormat::U16 => {
                    let state_ref = state.clone();
                    let app_ref = app.clone();
                    let dev_name_for_cb = active_device_name.clone();
                    let broken_for_err = stream_broken.clone();
                    let cb_time_ref = last_callback_ms.clone();
                    device.build_input_stream(
                        &stream_config,
                        move |data: &[u16], _| {
                            cb_time_ref.store(now_epoch_ms(), Ordering::Relaxed);
                            let converted: Vec<f32> = data
                                .iter()
                                .map(|&s| ((s as f32) - 32768.0) / 32768.0)
                                .collect();
                            push_and_emit(
                                &converted,
                                channels,
                                sample_rate,
                                &dev_name_for_cb,
                                &state_ref,
                                &app_ref,
                            );
                        },
                        move |err| {
                            eprintln!("[AuraLine Output Loopback] 播放设备切换，准备自动重连: {}", err);
                            broken_for_err.store(true, Ordering::SeqCst);
                        },
                        None,
                    )
                }
                _ => {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            if let Ok(stream) = stream_result {
                if stream.play().is_ok() {
                    let mut tick_count = 0u32;
                    let mut was_silent_idle = false;

                    loop {
                        std::thread::sleep(Duration::from_millis(100));
                        tick_count = tick_count.wrapping_add(1);

                        if stream_broken.load(Ordering::SeqCst) {
                            break;
                        }

                        let idle_ms =
                            now_epoch_ms().saturating_sub(last_callback_ms.load(Ordering::Relaxed));
                        if idle_ms > 140 {
                            if !was_silent_idle {
                                if let Ok(mut guard) = state.lock() {
                                    guard.reset_on_silence();
                                }
                                was_silent_idle = true;
                            }
                            let _ = app.emit(
                                "audio-telemetry",
                                AudioTelemetryPayload::silent(&active_device_name),
                            );
                        } else {
                            was_silent_idle = false;
                        }

                        if tick_count % 20 == 0 {
                            if let Some(current_out) = host.default_output_device() {
                                if let Ok(current_name) = current_out.name() {
                                    if current_name != active_device_name {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(400));
        }
    });
}

fn push_and_emit(
    interleaved: &[f32],
    channels: usize,
    sample_rate: f32,
    device_name: &str,
    state: &Arc<Mutex<DspState>>,
    app: &AppHandle,
) {
    let mut guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    for frame in interleaved.chunks(channels.max(1)) {
        let mono: f32 = frame.iter().sum::<f32>() / (frame.len() as f32);
        guard.ring_buffer.push(mono);
    }

    while guard.ring_buffer.len() >= FFT_SIZE {
        let block: Vec<f32> = guard.ring_buffer.drain(0..FFT_SIZE).collect();
        let payload = guard.process_block(&block, sample_rate, device_name);
        let _ = app.emit("audio-telemetry", payload);
    }
}
