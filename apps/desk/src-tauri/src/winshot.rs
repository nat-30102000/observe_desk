//! Screen capture with GDI (Windows only). Captures the whole virtual desktop, all monitors.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// Position and size of the virtual desktop in physical pixels.
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub fn virtual_area() -> Area {
    unsafe {
        Area {
            x: GetSystemMetrics(SM_XVIRTUALSCREEN),
            y: GetSystemMetrics(SM_YVIRTUALSCREEN),
            width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
            height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
        }
    }
}

/// PNG bytes of the whole virtual desktop.
pub fn capture_png(area: &Area) -> Result<Vec<u8>, String> {
    if area.width <= 0 || area.height <= 0 {
        return Err("No screen found".into());
    }
    unsafe {
        let screen = GetDC(Some(HWND(std::ptr::null_mut())));
        if screen.is_invalid() {
            return Err("Could not read the screen".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, area.width, area.height);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));
        let copied = BitBlt(mem, 0, 0, area.width, area.height, Some(screen), area.x, area.y, SRCCOPY | CAPTUREBLT);

        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: area.width,
            biHeight: -area.height, // negative: top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut pixels = vec![0u8; (area.width as usize) * (area.height as usize) * 4];
        let lines = GetDIBits(mem, bitmap, 0, area.height as u32, Some(pixels.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);

        SelectObject(mem, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(mem);
        ReleaseDC(Some(HWND(std::ptr::null_mut())), screen);

        if copied.is_err() || lines == 0 {
            return Err("Could not copy the screen".into());
        }
        // GDI gives BGRA with an unused alpha byte; PNG wants RGBA.
        for px in pixels.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, area.width as u32, area.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&pixels).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
        Ok(out)
    }
}
