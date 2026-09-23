# CHROMOA - Magical Hands ✨

**CHROMOA** is a Next.js computer vision web application powered by MediaPipe hand tracking. Turn your hand and fingers into a magical wand—planting flowers, creating glowing constellations, sketching light trails, summoning & catching Pokémon, and playing with animated dancing cats directly on camera!

---

## 🌟 Abilities & Features

| Tool / Ability | Description | Gesture Controls |
|---|---|---|
| 🎨 **Pen Tool** | Sketch glowing magical lines in the air | Point your index finger to sketch. Lines automatically fade out smoothly when movement stops. |
| 🌸 **Flowers** | Plant continuous vibrant flower trails | Point your index finger to plant flowers. Open your palm to scatter them like fireworks. |
| ⭐️ **Constellations** | Create starry constellations | Hold still ~300ms to place a star. Close your fist to light up stars, and open your palm to release them. |
| 🐉 **Creatures (Pokémon)** | Summon & catch wild Pokémon | Hold 1, 2, or 3 fingers to summon creatures. Open your palm to generate a Pokéball and close your fist over a creature to catch it into your Dex collection. |
| 🐱 **Cats Tool** | 10 large non-overlapping dancing GIF cats with music | Wave or shake your hand to activate 10 animated dancing cats on screen with music playback. Cats pause and disappear when hand movement stops. |

---

## 🚀 Key Technical Highlights

- **Real-Time Hand Tracking**: Uses MediaPipe Tasks Vision for 60 FPS multi-hand landmark detection.
- **AABB Collision & Separation**: Custom Axis-Aligned Bounding Box (AABB) physics engine ensuring cat overlays float dynamically without visual overlap.
- **Responsive Scaling**: Cat sizes scale dynamically from mobile (`52px`-`76px`) up to desktop (`130px`-`190px`).
- **UI Exclusion Zones**: Particle spawning and movement algorithms prevent overlays from obscuring UI camera buttons and top navbar.
- **Media Capture**: iOS-style camera bar supporting instant PNG photos and WebM/MP4 video recording.

---

## 💻 Local Development Setup

```bash
# Clone the repository
git clone https://github.com/4ntith3sis/chromoa-magic-hand.git
cd chromoa-magic-hand

# Install dependencies
npm install

# Launch development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser and grant camera permissions.

---

## 📦 Production Build

```bash
# Build Next.js production application
npm run build

# Run production server
npm run start
```

---

## 📄 License

MIT License. Created with ❤️ for interactive web experiences.
