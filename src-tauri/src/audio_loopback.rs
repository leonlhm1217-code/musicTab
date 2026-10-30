use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::f32::consts::PI;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const FFT_SIZE: usize = 1024;

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
}

struct DspState {
    ring_buffer: Vec<f32>,
    hann_window: Vec<f32>,
    prev_bass: f32,
    beat_cooldown: u32,
    smooth_pitch: f32,
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
        }
    }

    fn process_block(&mut self, samples: &[f32], sample_rate: f32) -> AudioTelemetryPayload {
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

        for i in 1..half_bins {
            let freq = (i as f32) * hz_per_bin;
            let mag = buffer[i].norm() / norm_factor;

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

        // 3. Dominant Pitch (Hz) estimation
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

        // 4. Onset Beat Detection
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
        }
    }
}

/// Spawns a background Rust thread that automatically binds to the default sound card
/// output loopback (WASAPI Loopback on Windows) and emits `"audio-telemetry"` IPC events.
pub fn spawn_soundcard_loopback(app: AppHandle) {
    std::thread::spawn(move || {
        let host = cpal::default_host();

        // Priority 1: System Default Output Device (WASAPI Loopback captures speaker/headphone output directly)
        // Priority 2: System Default Input Device (Stereo Mix / Loopback mic fallback)
        let (device, config) = if let Some(out_dev) = host.default_output_device() {
            if let Ok(cfg) = out_dev.default_output_config() {
                (out_dev, cfg)
            } else if let Some(in_dev) = host.default_input_device() {
                let cfg = in_dev.default_input_config().expect("无法读取默认音频输入配置");
                (in_dev, cfg)
            } else {
                return;
            }
        } else if let Some(in_dev) = host.default_input_device() {
            let cfg = in_dev.default_input_config().expect("无法读取默认音频输入配置");
            (in_dev, cfg)
        } else {
            return;
        };

        let sample_rate = config.sample_rate().0 as f32;
        let channels = config.channels() as usize;
        let sample_format = config.sample_format();
        let stream_config: cpal::StreamConfig = config.into();

        let state = Arc::new(Mutex::new(DspState::new()));
        let state_ref = state.clone();
        let app_ref = app.clone();

        let err_fn = |err| eprintln!("[AuraLine Audio Loopback] 声卡流错误: {}", err);

        let stream = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    push_and_emit(data, channels, sample_rate, &state_ref, &app_ref);
                },
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let converted: Vec<f32> = data.iter().map(|&s| s.to_float_sample()).collect();
                    push_and_emit(&converted, channels, sample_rate, &state_ref, &app_ref);
                },
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    let converted: Vec<f32> = data.iter().map(|&s| s.to_float_sample()).collect();
                    push_and_emit(&converted, channels, sample_rate, &state_ref, &app_ref);
                },
                err_fn,
                None,
            ),
            _ => return,
        };

        if let Ok(s) = stream {
            let _ = s.play();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
    });
}

fn push_and_emit(
    interleaved: &[f32],
    channels: usize,
    sample_rate: f32,
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
        let payload = guard.process_block(&block, sample_rate);
        let _ = app.emit("audio-telemetry", payload);
    }
}
