---
name: CropSathi
colors:
  surface: '#fbf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fbf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae8e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#3f4941'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0f0'
  outline: '#6f7a71'
  outline-variant: '#bec9bf'
  surface-tint: '#006d40'
  primary: '#006038'
  on-primary: '#ffffff'
  primary-container: '#1a7a4c'
  on-primary-container: '#abffc9'
  inverse-primary: '#80d9a2'
  secondary: '#5f5f5a'
  on-secondary: '#ffffff'
  secondary-container: '#e1e0da'
  on-secondary-container: '#63635e'
  tertiary: '#933302'
  on-tertiary: '#ffffff'
  tertiary-container: '#b44a1b'
  on-tertiary-container: '#ffe8e1'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#9bf6bd'
  primary-fixed-dim: '#80d9a2'
  on-primary-fixed: '#002110'
  on-primary-fixed-variant: '#00522f'
  secondary-fixed: '#e4e2dd'
  secondary-fixed-dim: '#c8c6c1'
  on-secondary-fixed: '#1b1c19'
  on-secondary-fixed-variant: '#474743'
  tertiary-fixed: '#ffdbce'
  tertiary-fixed-dim: '#ffb599'
  on-tertiary-fixed: '#370e00'
  on-tertiary-fixed-variant: '#7f2a00'
  background: '#fbf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e1'
typography:
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Be Vietnam Pro
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Noto Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Noto Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-lg:
    fontFamily: Noto Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.5px
  label-sm:
    fontFamily: Noto Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  margin-mobile: 20px
  gutter-mobile: 16px
  tap-target-min: 48px
  stack-gap: 12px
---

## Brand & Style
The design system is built on a foundation of reliability and warmth, specifically tailored for Indian smallholder farmers. The personality is "Modern Rural"—it feels like a professional government-backed tool rather than a cold corporate app. 

The visual style follows a **Modern Tactile** approach, combining clean, large elements with soft shadows and organic colors. It prioritizes clarity and high-contrast visuals to ensure usability in direct sunlight (outdoor farm environments). Minimal text and icon-heavy navigation accommodate users with varying literacy levels and those who prefer visual cues over reading.

## Colors
The palette is deeply rooted in the agricultural landscape:
- **Primary (Forest Green):** Used for main actions, active states, and branding. It signifies health and growth.
- **Secondary (Off-White):** The base background color. It reduces glare compared to pure white, making it easier to read outdoors.
- **Tertiary (Terracotta Orange):** Reserved for alerts, urgent disease detection, and critical warnings.
- **Quaternary (Lavender):** Used for data visualization, record-keeping, and neutral status cards to differentiate informational content from actionable agricultural tasks.
- **Neutral:** A deep charcoal instead of pure black for text to maintain readability while appearing more organic.

## Typography
This design system utilizes **Be Vietnam Pro** for headlines to provide a friendly, contemporary feel. For body text and labels, **Noto Sans** is used specifically for its exceptional support of Devanagari and other Indic scripts, ensuring uniform vertical rhythm and legibility across languages.

Font sizes are intentionally larger than standard SaaS applications to ensure readability in bright sunlight. Line heights are generous to prevent crowded text blocks, which can be challenging for non-native readers or those with lower digital literacy.

## Layout & Spacing
The layout follows a **Fluid Grid** model with high-density margins (20px) to prevent accidental palm-touches on edge-to-edge mobile screens. 

- **Tap Targets:** Every interactive element must be a minimum of 48x48dp.
- **Visual Rhythm:** A 4px baseline grid is used. Spacing between related items should be 12px (stack-gap), while spacing between sections should be 32px to provide clear visual separation.
- **Icon-First:** Navigation and key actions must lead with an icon, followed by a short, descriptive label in the local script.

## Elevation & Depth
Depth is used sparingly but purposefully to indicate interactable surfaces.
- **Surface Cards:** Use a subtle, low-blur shadow (`0px 4px 12px rgba(0,0,0,0.05)`) against the off-white background to make them feel "lifted" and touchable.
- **Active State:** When a card or button is pressed, the shadow is removed, and a subtle inner stroke (1px) of the primary color is applied.
- **Floating Action Buttons (FAB):** Specifically for the "Scan" function, a higher elevation is used to denote it as the primary app utility.

## Shapes
The shape language is "Friendly & Organic." A 12px (`rounded-lg`) corner radius is the standard for cards and input fields. This softens the interface, making it feel more approachable and less "institutional." Buttons use a fully rounded/pill shape to maximize their appearance as distinct touch targets.

## Components
- **Buttons:** Primary buttons are Forest Green with white Noto Sans Medium text. Secondary buttons use a Forest Green outline with a 2px stroke.
- **Bottom Tab Navigation:** 4 tabs (Home, Scan, Cases, Profile). The "Scan" tab is emphasized with a circular Forest Green background and a white camera icon. Labels are always visible beneath icons.
- **Status Cards:** Use the Lavender background for "In Progress" or "Historic" records. Use the Terracotta Orange for "Disease Detected" alerts with high-contrast white text.
- **Input Fields:** Large 56px height fields with 12px rounded corners. Labels should be floating or persistent above the field, never placeholder-only, to ensure context isn't lost.
- **Disease Result Chips:** Small, high-contrast chips used to tag crop types (e.g., "Wheat," "Rice") using the Forest Green primary color but at 10% opacity for the background and 100% for the text.
- **Camera Viewfinder:** A specialized component for the Scan feature with a 12px rounded stroke guiding the user to center the leaf or crop.
## Alignment With Product Flow

Cross-reference with `PRD.md`:

- **Terracotta Orange (tertiary)** — "Disease Detected" alerts and the Part 2 confirmation-gate outcomes (`Diagnosis Confirmed`, escalation states)
- **Lavender (quaternary)** — "In Progress" / historic records; maps to the passive-monitoring and follow-up states in Part 1 and Part 3 (risk fusion, continued monitoring, case history)
- **Forest Green (primary)** — main actions, including the "Scan" FAB that triggers Part 2's guided photo capture
- **Status Cards** — the false-alarm and confirmed-diagnosis outcomes in `PRD.md` Part 2 map directly to this component: Lavender for false-alarm/monitoring states, Terracotta for confirmed detections
