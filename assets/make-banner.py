# Regenerates assets/warden-banner.jpg: a dark navy with a subtle blue glow, to sit well behind the dark avatar.
# Needs Pillow and numpy (pip install pillow numpy). Optional: the JPG is already in the repo.
import numpy as np
from PIL import Image
W, H = 2040, 720  # 3x Discord's 680x240
a, b = np.array([14, 20, 36]), np.array([44, 82, 160])  # near-black navy on the left (behind the avatar) to a muted blue on the right
yy, xx = np.mgrid[0:H, 0:W]
t = ((xx / W) * 0.85 + (yy / H) * 0.15)[..., None]
t = t * t * (3 - 2 * t)
img = a + (b - a) * t
img += np.random.default_rng(3).normal(0, 0.8, (H, W, 1))  # a hair of noise so the gradient has no visible banding
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('warden-banner.jpg', quality=93)
