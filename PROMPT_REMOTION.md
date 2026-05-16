# Prompt for Remotion Video Generation

Copy and paste the following prompt to your target LLM (like Claude, ChatGPT, or Cursor) to generate your Remotion v4 video project:

***

**Role:** You are an expert React developer specializing in Remotion v4. 

**Goal:** Create a high-quality, professional promotional video Composition for a mobile app using Remotion.

**Technical Specifications:**
- **Framework:** Remotion v4 (React).
- **Format:** Horizontal Video (1920x1080).
- **FPS:** 60 fps for smooth animations.
- **Duration:** Approximately 10-15 seconds (calculate frames accordingly).

**Design & Aesthetic (iOS Style):**
- **Vibe:** Clean, modern, minimalist iOS aesthetic.
- **Background:** Soft, off-white or light gray subtle gradient.
- **Assets:** Include an iPhone device mockup. Assume there is a local image asset available (e.g., `static/iphone-mockup.png`) and use the `<Img />` component from Remotion to display it.
- **UI Elements:** 
  - **Cards:** White cards with soft, large blur shadows (resembling iOS widgets or modals).
  - **Buttons:** Vibrant iOS-style blue primary buttons (`#007AFF` or similar) with rounded corners (`border-radius: 9999px` or `16px`).
  - **Text:** Clean sans-serif typography (system fonts like San Francisco/Inter). Use dark gray for primary text, and **green text** (`#34C759`) for positive highlights (e.g., success messages, savings, earnings).

**Animations:**
- Do not use linear animations. **ALL** animations must feel native to iOS.
- Use Remotion's `spring` function to create bouncy, fluid movements.
- Elements (like the white cards and blue buttons) should appear using a **slide-up** and **fade-in** effect (interpolating the Y-axis and opacity based on a spring value).
- The iPhone mockup should smoothly scale up and float into the center of the screen.

**Deliverables:**
1. The `Root.tsx` configuration defining the `Composition`.
2. The main `Video.tsx` file containing the timeline and sequence of elements.
3. Reusable components (e.g., `DeviceFrame`, `FeatureCard`) demonstrating how to apply the spring animations and styling.
4. Use standard inline styles or standard CSS.

Please provide the complete, modular code so I can drop it into my newly initialized Remotion project and run it immediately.
***