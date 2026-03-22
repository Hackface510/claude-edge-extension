#!/usr/bin/env python3
"""
Generate PNG icons for the Claude Edge Extension from icon.svg.

Requirements:
    pip install cairosvg

Usage:
    cd icons
    python generate_icons.py

Output:
    icon16.png, icon32.png, icon48.png, icon128.png
"""

import os
import sys

SIZES = [16, 32, 48, 128]
SVG_FILE = os.path.join(os.path.dirname(__file__), 'icon.svg')

def main():
    try:
        import cairosvg
        for size in SIZES:
            out = os.path.join(os.path.dirname(__file__), f'icon{size}.png')
            cairosvg.svg2png(url=SVG_FILE, write_to=out, output_width=size, output_height=size)
            print(f'Generated {out} ({size}x{size})')
        print('Done! All icons generated.')
    except ImportError:
        print('cairosvg not found. Trying Pillow + rsvg fallback...')
        try:
            from PIL import Image
            import io
            # Try wand as alternative
            try:
                from wand.image import Image as WImage
                for size in SIZES:
                    out = os.path.join(os.path.dirname(__file__), f'icon{size}.png')
                    with WImage(filename=SVG_FILE, format='svg') as img:
                        img.resize(size, size)
                        img.save(filename=out)
                    print(f'Generated {out}')
            except ImportError:
                print('ERROR: Neither cairosvg nor wand is installed.')
                print('Install one of:')
                print('  pip install cairosvg')
                print('  pip install Wand')
                print()
                print('Alternative: Convert icon.svg manually using:')
                print('  - Inkscape: inkscape --export-type=png --export-width=128 icon.svg -o icon128.png')
                print('  - ImageMagick: convert -size 128x128 icon.svg icon128.png')
                print('  - Online: https://convertio.co/svg-png/')
                sys.exit(1)
        except ImportError:
            print('No suitable library found. Please install cairosvg: pip install cairosvg')
            sys.exit(1)

if __name__ == '__main__':
    main()
