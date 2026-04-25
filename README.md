# Ambitecture: Core Concept & Architecture

## 1. Executive Summary

**Ambitecture** (Ambient Architecture Engine) is a distributed framework for the **live orchestration** of physical environments.

### "Open spatial control of objects for the rest of us."

Ambitecture moves beyond traditional lighting desks and proprietary hardware by decoupling creative **Intent** from execution. It democratizes complex spatial math, allowing creators to treat a physical venue as a dynamic canvas. Instead of managing channels and faders, Ambitecture allows for composition using **Spatial Objects** and **Volumes**, where hardware nodes (Renderers) autonomously interpret high-level performance data based on their physical location.

## 2. The Three Pillars

### A. The Hub (The Conductor)

The Hub is the persistent central authority managing the global coordinate system and the master "Score."

* **State Compositor:** Manages the 3D scene graph and the real-time z-index layer stack.
* **Spatial Broadcasting:** When a controller requests "Light at Coordinate A," the Hub broadcasts this intent to all Renderers whose Bounding Boxes overlap that coordinate.
* **Clock Master:** Provides a master sync signal (via PTP/NTP) so all Renderers execute events at the exact same millisecond.

### B. The Renderers (The Intelligent Performers)

A Renderer is a spatial gateway (e.g., a Raspberry Pi, ESP32, or PC).

* **Self-Description (The Handshake):** Renderers connect and define their presence via a Bounding Box (min/max XYZ) and a list of internal Assets.
* **Spatial Interpretation:** The Renderer calculates how its assets interact with spatial events based on local geometry.
* **Autonomous Sequence Player (ASP):** Renderers buffer timed events locally to eliminate network jitter.
* **JavaScript Runtime:** Renderers receive JS functions from the Hub to update logic (e.g., custom easing) without a firmware flash.

### C. The Controllers (The Composers)

Controllers are the triggers for spatial actions (Unity Twins, iPad LiDAR, AI Agents).

* **Intent Broadcasting:** High-level actions like "Light at [x,y,z] with 1m radius."
* **Discovery:** Controllers query the Hub for available Rooms and Volumes.

## 3. The Color Philosophy: CIE 1931

Ambitecture uses the **CIE 1931 Chromaticity Space ($xyY$)** as its native color language. This ensures that the Hub speaks "Human Perception" while the Renderer speaks "Hardware."

### Why CIE 1931?

Standard RGB is device-dependent. A value of `(255, 0, 0)` looks different on an LED strip than on a laser or a TV. $xyY$ provides a mathematical standard:

* **$x, y$ (Chromaticity):** Defines the color point regardless of brightness.
* **$Y$ (Luminance):** Defines the perceived brightness.

### The Math of Spatial Blending

When two spatial objects overlap, their colors must mix. Traditional RGB mixing often results in "muddy" or mathematically incorrect transitions. In Ambitecture, blending occurs in the CIE space:

1. **Additive Mixing:** If two lights hit the same point, the Renderer adds their $Y$ values and calculates the weighted average of their $xy$ coordinates.
2. **Gamut Mapping:** Each Renderer maintains a "Gamut Map" of its fixtures. If the Hub requests a coordinate outside the fixture's capability (e.g., a highly saturated teal that a cheap LED cannot hit), the Renderer uses a local algorithm to snap to the closest reachable point on the **Spectral Locus**.

## 4. The Logic of Spatial Intent

* **Intersection Model:** Every frame, a Renderer checks the intersection of its assets and the active "Intent Volumes."
* **Atmos-style Mapping:** Just as Atmos maps sound to speakers, Ambitecture maps "Light Intent" to physical emitters based on their 3D orientation.
* **Non-Destructive Layers:** A z-indexed stack allows for complex layering. Removing a "Flash" event layer instantly restores the "Ambient Sunset" layer beneath it without state-tracking overhead.

## 5. Minimum Implementation Goals (The Scaffold)

1. **The Handshake:** Renderer registers its 3D Bounding Box.
2. **The Spatial Event:** Hub sends $xyY$ color data to a coordinate. Renderer triggers local assets if they "see" that coordinate.
3. **The Autonomous Queue:** Hub sends a sequence of three timed movements. Renderer buffers and plays them in sync.
4. **The Logic Update:** Hub pushes a JS function to the Renderer to change the "Falloff Curve" (e.g., Linear to Inverse Square) in real-time.
