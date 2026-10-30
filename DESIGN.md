# AuraLine — Impeccable Design System (`DESIGN.md`)

> Grounded in [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (`Context-Driven Design`, `/audit`, `/critique`, `/distill`, `/quieter`, `/polish`, `/typeset`).

---

## 1. Aesthetic Direction & Domain Exemplars

- **Archetype**: Precision Acoustic Hardware Console & Vacuum Fluorescent Display (VFD) Spectrum Instrument.
- **Real-World Exemplars**:
  - **Pioneer Carrozzeria DEH-P99 / ODR**: Deep smoked acrylic VFD window, high-contrast cyan/amber phosphor segments, hairline engraved frequency scales, zero superfluous chrome.
  - **Alpine CDA-7990 F#1 Status**: Anodized black brushed-aluminum faceplate, chamfered champagne-gold tactile selectors, strict typographic hierarchy, and clean single-plane divider geometry.
- **Core Philosophy**:
  - **Form follows acoustic telemetry**: The live VFD spectrum analyzer bay is the undisputed focal point of the console. Every surrounding control exists quietly to calibrate slot geometry, phosphor filtering, or signal gain.
  - **Single-elevation instrument surface**: Controls sit directly on the anodized chassis, separated by `1px` structural hairlines rather than nested cards.

---

## 2. Color & Atmospheric Polarity (60-30-10 Budget)

### 60% Primary Chassis (Anodized Brushed Aluminum)
- **Chassis Base**: `#09090B` (`--chassis-bg`) with subtle brushed horizontal micro-grain.
- **Elevated Control Well**: `#0E0E12` (`--chassis-well`) for recessed segmented tracks and fader troughs.

### 30% Secondary Structure & Recessed VFD Glass
- **VFD Smoked Acrylic Window**: `#040507` (`--vfd-glass`) with subtle internal scanline mesh and inset shadow depth.
- **Structural Hairlines**: `rgba(255, 255, 255, 0.07)` (`1px solid`) separating functional rows without card enclosures.
- **Typography Hierarchy**:
  - Primary Instrument Labels: `#F4F4F6`
  - Secondary Technical Copy: `#A1A1AA`
  - Muted Calibrations & Scale Marks: `#71717A`

### 10% Functional & Hardware Accents
- **Champagne Gold Hardware Indicator**: `#D4AF37` / `#E5C158` (`--accent-gold`) for active selector indicators, fader thumbs, and precision focus rings.
- **VFD Phosphor Cyan**: `#00F5D4` (`--vfd-cyan`) for primary spectrum telemetry readouts.
- **Peak-Hold Warning Amber**: `#F59E0B` (`--vfd-amber`) for peak retention indicators and high-gain calibration alerts.

---

## 3. Typography & Scannable Hierarchy (2+1 System)

- **Display / Model Engraving (`--font-display`)**: `'Outfit', sans-serif` — Used sparingly for model designation (`AURALINE`), section index numerals (`01.`–`05.`), and primary hardware headers.
- **UI & Control Copy (`--font-sans`)**: `'Plus Jakarta Sans', sans-serif` — Clean, legible Chinese and Latin labels for settings rows and descriptions.
- **Telemetry & Calibration Readouts (`--font-mono`)**: `'JetBrains Mono', monospace` with strict `font-variant-numeric: tabular-nums` — Used for all frequency scales (`32Hz`–`16kHz`), pixel offsets (`+12 px`), opacity percentages (`100 %`), and band counts (`24 BANDS`).
- **Numeric / Unit Separation**: Numeric values are always rendered at higher contrast (`#F4F4F6` or `#E5C158`) with units (`px`, `%`, `Hz`, `×`, `BANDS`) offset in muted smaller type (`#71717A`).

---

## 4. Layout Architecture & Tactile Controls

1. **Focal Point Anchor (VFD Live Display Bay)**:
   - Positioned at the top of the console with a recessed smoked-glass bezel (`#040507`).
   - Top telemetry strip displays unboxed `·`-separated readouts (`SLOT`, `BANDS`, `OPACITY`, `ENGINE STATE`).
   - Bottom calibration rail provides a 10-point logarithmic ISO frequency scale (`32Hz` to `16kHz`).
2. **Zero-Card-Nesting Control Matrix**:
   - No `rounded-xl` cards inside cards.
   - Sections `01.` through `05.` are structured via full-bleed `1px` hairline dividers (`divide-y divide-white/[0.07]`).
3. **Hardware Faders & Double-Click Reset**:
   - Custom anodized track with a chamfered champagne-gold indicator thumb.
   - Double-clicking any fader immediately snaps the parameter back to its factory calibration default.
4. **Single-Line Interactive Discipline**:
   - Every segmented button, preset selector, and action trigger enforces `whitespace-nowrap shrink-0` so hardware labels never wrap or clip across viewports.

---

## 5. Anti-Slop & Restraint Guardrails (`/quieter` & `/distill`)

- **No Card-in-Card Nesting**: Never place bordered cards inside bordered section containers.
- **No Decorative Header Icons**: Section headers use clean editorial index numbers (`01.`–`05.`) instead of decorative icons next to every title.
- **No Pulsing Status Dots**: Never use `animate-pulse` colored circles (`bg-emerald-400 rounded-full`) to indicate state; use crisp tabular text readouts (`NOMINAL 60 FPS` / `STANDBY 0 FPS`).
- **No Static Pill Badges**: Metadata and telemetry tags must remain unboxed, separated by middle dots (`·`) or slashes (`/`).
- **No `//` Code-Comment Headers**: Section headers use clean typographic numbering (`01. 任务栏停靠槽位`).
