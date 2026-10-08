//! Text recognition with the OCR engine built into Windows 10 and 11 (Windows only, offline).

use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Recognise text in a PNG using the languages in the user's profile. Blocks, so call off the UI thread.
pub fn recognize_png(png: &[u8]) -> Result<String, String> {
    // Already-initialised threads return an error that is safe to ignore.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let stream = InMemoryRandomAccessStream::new().map_err(err)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(err)?;
    writer.WriteBytes(png).map_err(err)?;
    writer.StoreAsync().map_err(err)?.get().map_err(err)?;
    writer.FlushAsync().map_err(err)?.get().map_err(err)?;
    writer.DetachStream().map_err(err)?;
    stream.Seek(0).map_err(err)?;

    let decoder = BitmapDecoder::CreateAsync(&stream).map_err(err)?.get().map_err(err)?;
    let bitmap = decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)
        .map_err(err)?
        .get()
        .map_err(err)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| "Windows has no OCR language installed. Add one in Settings > Time & language > Language & region.".to_string())?;
    let result = engine.RecognizeAsync(&bitmap).map_err(err)?.get().map_err(err)?;
    Ok(result.Text().map_err(err)?.to_string())
}
