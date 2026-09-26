# RI'S ART — scroll film site

A static site for a nail-art studio. It opens with a 15-second film that plays as you scroll, then shows the studio: menu and prices, a look book, how a visit works, WhatsApp booking, FAQ, and hours.

## Run it

```
node serve.mjs 8101
```

Then open http://localhost:8101. Use this server, not `python -m http.server`. The film can only be seeked when the server supports HTTP Range requests, and Python's server doesn't.

## Edit content

Everything editable is in `config.js`:

- **Before launch, replace everything marked `PLACEHOLDER`:** city, WhatsApp number, phone, Instagram, address, map link, hours and all prices.
- `beats` holds the film text, one entry per scroll beat. `pos` moves the text off the action, and `vh` sets how long each beat holds.
- `focus` sets where the crop sits on phones at each second of the film. Retune it if the film changes.
- `looks` holds the look-book images. **Right now these are stills from the AI brand film, not client work.** Swap in photos of Ri's real sets (4:5 crops) before launch.

## Film

- `assets/film.mp4` and `assets/film.webm` are encoded with a keyframe every 5 frames (`-g 5`), which keeps scrubbing smooth.
- The source clips are Google Flow / Veo 3.1 Lite (`raw/shot1.mp4`, `raw/shot2.mp4`), joined with a 0.6s dissolve. See `SHOTS.md` for how they were designed.
- The clips carry Veo's small visible AI watermark in the bottom-right corner. It has been left in place.

To rebuild after replacing clips:

```
ffmpeg -i raw/shot1.mp4 -i raw/shot2.mp4 -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.6:offset=7.4,format=yuv420p[v]" -map "[v]" -an -c:v libx264 -crf 21 -preset slow -g 5 -keyint_min 5 -sc_threshold 0 -movflags +faststart assets/film.mp4
ffmpeg -i assets/film.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 36 -g 5 -row-mt 1 assets/film.webm
```

## AR nail try-on

Visitors can open it from the **"See it on your hands first"** section or from **Try on** on any menu card; the card sets the starting look.

### How it works (Snap-style)

1. **Hand tracking.** Google MediaPipe HandLandmarker 1.0.1 finds 21 points per hand, for up to 2 hands. Low-contrast frames (backlit, washed-out, tinted webcams) are auto-levelled before tracking and before the nail model; what you see on screen is unchanged. If the active tracker (GPU) sees no hand for about half a second, the CPU tracker takes over, and the other way round, because each fails on different frames.
2. **Fingertip crops.** Each visible fingertip is cut out as a 128×128 tile rotated so the nail points up (`ar-gl.js` `cropMatrix`, identical to `risart-ml/nailcrop.py`).
3. **Nail segmentation.** NailNet, a 78k-parameter depthwise U-Net trained for this site (v5), finds the exact nail pixels in every tile at once. It runs as WebGL shaders (`nailnet-gl.js`) with no ML runtime to download; the weights are 312 KB.
4. **Is it really a nail?** Every mask is scored on confidence, solidity and width. Faint, torn or thin masks (finger pads, skin edges against a bright window) fade out instead of being painted, and they never grow an extension.
5. **Temporal smoothing.** Masks are blended over time in each fingertip's own frame, so they stay steady while the hand moves.
6. **Geometry.** The smoothed mask gives each nail's real width, cuticle line, free edge and brightness.
7. **Composite (one shader).** The camera frame is drawn with every real nail pixel repainted in the chosen colour. The camera's own shading and reflections are kept, so it reads as polish on the nail, not a sticker. Extensions are grown from the real free edge in the chosen chart shape, with curvature shading matched to the nail's brightness and a soft contact shadow. Designs are computed in each nail's own coordinates.
8. **Which nails show.** Landmarks rule out fingertips inside the palm and, with the palm toward the camera, straight fingers. Everything else (thumbs, folded fingers, side views) goes to the model, which paints only where it actually sees a nail. The 2D fallback has no model, so it also hides fingers the landmarks say are folded under.
9. **No spill.** At natural length only real nail pixels are painted. The chart shape only adds length beyond the free edge, and extensions grow in and out over a few frames instead of popping.

Devices without WebGL2 float render targets fall back to `ar-2d.js`, which places nails from the landmarks alone.

### Shapes, designs, shades

- **Shapes** follow the standard salon chart: almond, oval, round, squoval, square, coffin (ballerina), stiletto, lipstick and flare. They are defined once in `nailshape.js`, which drives the menu chips, the try-on chips and the shader, so all three always match.
- **Lengths:** natural, short, medium, long.
- **Designs,** from 2026 trend research: gel gloss, jelly, milky, glazed chrome, aura, velvet cat-eye, classic French, micro French, ombré, glitter, gold foil accent (ring finger), marble, tortoiseshell and matte.
- **Shades** live in `config.js` → `tryon.shades`. The `tryon` field on each menu item sets the look that item opens with.

### The nail model (`D:/risart-ml`)

- **Training data:**
  - 52 CC0 photos with human-drawn masks (vpapenko nails-segmentation dataset)
  - chroma-key hands generated in Google Flow (Nano Banana, 0 credits) with nails painted pure green, which gives pixel-exact masks; includes fists, thumbs-up, cup and pen grips and side views
  - frames from two Veo 3.1 Lite chroma videos (a hand turning and closing), for motion and pose variety
- **Augmentation:** the training repaints nails in random colours, including bare-nail pink derived from the person's own skin, so the model learns nail shape rather than colour.
- **Accuracy (v5)**, through the full live path (tracking, smoothing, compositing), against exact masks in `_dev/bench` (`eval_feed.py`):
  - Held-out video frames: precision 0.93, recall 0.93, IoU 0.87, worst-10% frame IoU 0.78. (v2: IoU 0.77, worst frames 0.)
  - Same frames washed out like a backlit laptop webcam (`_dev/bench_wash`): IoU 0.42, precision 0.86. (v4 before the lighting fixes: 0.11.) This is still the weakest case.
  - 52 CC0 photos: IoU 0.85, spill beyond 2 px 2.8%.
- **Known limit:** MediaPipe sometimes loses hands that are crossed, heavily wrinkled or partly off frame. No nails are painted until it finds the hand again.
- **Pipeline:** `landmarks_browser.py` → `chroma_label.py` / `autolabel.py --use-gt` → `train.py` → `export_webgl.py` → copy `nailnet.json` and `nailnet.bin` into `assets/ar/`.

### Testing on your phone

Phone browsers only allow the camera on **https**. With the phone on the same Wi-Fi as this PC:

```
node serve.mjs 8102 --https
```

Open the `https://192.168.x.x:8102` address it prints. The phone will warn that the certificate is self-signed; choose Advanced, then Proceed. This is for testing only. Once hosted on a real https domain, the warning goes away.

## Hosting

### Railway (this repo)

The repo deploys to Railway as-is. `package.json` runs `npm start`, which runs `node serve.mjs`. When Railway sets `PORT`, the server listens on `0.0.0.0:$PORT`. There are no dependencies and no build step.

1. Railway → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. When the first deploy finishes, open the service → **Settings** → **Networking** → **Generate Domain**.
3. Open the `https://….up.railway.app` address. Railway provides https, so the AR camera works on phones with no certificate warning.

Every push to the default branch redeploys.

When hosted, the server refuses to serve hidden files, `_dev/`, `_test/` and `raw/`. Those folders are also kept out of git by `.gitignore`. Pages and code revalidate on every visit (ETag); `assets/` is cached for an hour.

### Other static hosts

Any static host that supports Range requests works. Netlify, Vercel, Cloudflare Pages and GitHub Pages all do, and all serve https, which the camera needs. Upload everything except `raw/`, `_dev/` (test pages and images) and `.cert/`. Make sure the host sends `.wasm` files as `application/wasm`; the big hosts already do.
