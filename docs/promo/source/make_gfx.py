"""Render transparent 1280x720 overlays: short supers and the closing card."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))

W, H = 1280, 720
OUT = os.path.join(HERE, "overlays")
SERIF = "/usr/share/fonts/opentype/urw-base35/C059-Bold.otf"
if not os.path.exists(SERIF):
    SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf"
LOGO = os.path.join(HERE, "logo.png")
CREAM = (246, 238, 222, 255)
GOLD = (229, 176, 64, 255)


def shadowed_text(img, xy, text, font, fill, anchor="la", blur=6, alpha=170):
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((xy[0] + 2, xy[1] + 3), text, font=font, fill=(0, 0, 0, alpha), anchor=anchor)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(sh)
    ImageDraw.Draw(img).text(xy, text, font=font, fill=fill, anchor=anchor)


def super_card(name, text):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # soft dark band behind lower-left text for legibility
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    for i in range(260):
        a = int(150 * (i / 260) ** 1.6)
        d.line([(0, H - 260 + i), (W, H - 260 + i)], fill=(10, 10, 12, a))
    img.alpha_composite(band)
    f = ImageFont.truetype(SANS, 84)
    d = ImageDraw.Draw(img)
    d.rectangle([72, H - 168, 84, H - 84], fill=GOLD)
    shadowed_text(img, (110, H - 126), text, f, CREAM, anchor="lm")
    img.save(f"{OUT}/{name}.png")


def end_card():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # darken top/centre for a clean title area
    veil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(veil)
    for y in range(H):
        t = max(0.0, 1 - y / (H * 0.85))
        d.line([(0, y), (W, y)], fill=(14, 14, 16, int(200 * t ** 0.8)))
    img.alpha_composite(veil)

    logo = Image.open(LOGO).convert("RGBA").resize((132, 132), Image.LANCZOS)
    title_f = ImageFont.truetype(SERIF, 104)
    tag_f = ImageFont.truetype(SANS, 44)
    title = "Checkers vs Jev"
    tw = ImageDraw.Draw(img).textlength(title, font=title_f)
    gap = 30
    total = logo.width + gap + tw
    x0 = int((W - total) / 2)
    cy = 205
    img.alpha_composite(logo, (x0, cy - logo.height // 2))
    shadowed_text(img, (x0 + logo.width + gap, cy), title, title_f, CREAM, anchor="lm")
    d = ImageDraw.Draw(img)
    d.rectangle([W // 2 - 60, 290, W // 2 + 60, 295], fill=GOLD)
    shadowed_text(img, (W // 2, 345), "3D checkers against an AI that plays to win.", tag_f, CREAM, anchor="mm")
    img.save(f"{OUT}/endcard.png")


super_card("super_yourmove", "Click. Move.")
super_card("super_jev", "Jev answers in seconds.")
super_card("super_strike", "Strike back.")
end_card()
print("ok")
