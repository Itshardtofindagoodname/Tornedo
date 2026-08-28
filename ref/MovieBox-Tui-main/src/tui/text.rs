use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

pub fn width(value: &str) -> usize {
    UnicodeWidthStr::width(value)
}

pub fn remove_last_grapheme(value: &mut String) {
    if let Some((index, _)) = value.grapheme_indices(true).next_back() {
        value.truncate(index);
    }
}

pub fn truncate_width(value: &str, max_width: usize) -> String {
    if width(value) <= max_width {
        return value.to_string();
    }
    if max_width <= 3 {
        return ".".repeat(max_width);
    }

    let content_width = max_width - 3;
    let mut output = String::new();
    let mut used = 0;
    for grapheme in value.graphemes(true) {
        let grapheme_width = width(grapheme);
        if used + grapheme_width > content_width {
            break;
        }
        output.push_str(grapheme);
        used += grapheme_width;
    }
    output.push_str("...");
    output
}

pub fn truncate_middle_width(value: &str, max_width: usize) -> String {
    if width(value) <= max_width {
        return value.to_string();
    }
    if max_width == 0 {
        return String::new();
    }
    if max_width <= 3 {
        return ".".repeat(max_width);
    }

    let content_width = max_width - 1;
    let start_width = content_width.div_ceil(2);
    let end_width = content_width - start_width;

    let mut start = String::new();
    let mut used = 0;
    for grapheme in value.graphemes(true) {
        let grapheme_width = width(grapheme);
        if used + grapheme_width > start_width {
            break;
        }
        start.push_str(grapheme);
        used += grapheme_width;
    }

    let mut end = Vec::new();
    used = 0;
    for grapheme in value.graphemes(true).rev() {
        let grapheme_width = width(grapheme);
        if used + grapheme_width > end_width {
            break;
        }
        end.push(grapheme);
        used += grapheme_width;
    }
    end.reverse();

    format!("{start}…{}", end.concat())
}

pub fn sanitize_language_label(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(*c as u32, 0x064B..=0x065F | 0x0670 | 0x06D6..=0x06ED))
        .collect();

    match cleaned.trim() {
        "العربية" | "Arabic" | "ara" | "ar" => "Arabic".to_string(),
        "اردو" | "أردو" | "Urdu" | "urd" | "ur" => "Urdu".to_string(),
        "বাংলা" | "Bengali" | "ben" | "bn" => "Bengali".to_string(),
        "हिन्दी" | "हिंदी" | "Hindi" | "hin" | "hi" => "Hindi".to_string(),
        "Filipino" | "Tagalog" | "fil" | "tl" => "Filipino".to_string(),
        "Indonesian" | "ind" | "id" => "Indonesian".to_string(),
        "English" | "eng" | "en" => "English".to_string(),
        "Español" | "Spanish" | "spa" | "es" => "Spanish".to_string(),
        "Français" | "French" | "fra" | "fre" | "fr" => "French".to_string(),
        "Deutsch" | "German" | "deu" | "ger" | "de" => "German".to_string(),
        "Italiano" | "Italian" | "ita" | "it" => "Italian".to_string(),
        "Português" | "Portuguese" | "por" | "pt" => "Portuguese".to_string(),
        "Русский" | "Russian" | "rus" | "ru" => "Russian".to_string(),
        "Türkçe" | "Turkish" | "tur" | "tr" => "Turkish".to_string(),
        "Tiếng Việt" | "Vietnamese" | "vie" | "vi" => "Vietnamese".to_string(),
        "中文" | "Chinese" | "zho" | "chi" | "zh" => "Chinese".to_string(),
        "日本語" | "Japanese" | "jpn" | "ja" => "Japanese".to_string(),
        "한국어" | "Korean" | "kor" | "ko" => "Korean".to_string(),
        "ไทย" | "Thai" | "tha" | "th" => "Thai".to_string(),
        "தமிழ்" | "Tamil" | "tam" | "ta" => "Tamil".to_string(),
        "తెలుగు" | "Telugu" | "tel" | "te" => "Telugu".to_string(),
        "മലയാളം" | "Malayalam" | "mal" | "ml" => "Malayalam".to_string(),
        "ಕನ್ನಡ" | "Kannada" | "kan" | "kn" => "Kannada".to_string(),
        "मराठी" | "Marathi" | "mar" | "mr" => "Marathi".to_string(),
        "ગુજરાતી" | "Gujarati" | "guj" | "gu" => "Gujarati".to_string(),
        "ਪੰਜਾਬੀ" | "Punjabi" | "pan" | "pa" => "Punjabi".to_string(),
        "فارسی" | "Persian" | "fas" | "per" | "fa" => "Persian".to_string(),
        "עברית" | "Hebrew" | "heb" | "he" => "Hebrew".to_string(),
        "Ελληνικά" | "Greek" | "ell" | "gre" | "el" => "Greek".to_string(),
        "Polski" | "Polish" | "pol" | "pl" => "Polish".to_string(),
        "Nederlands" | "Dutch" | "nld" | "dut" | "nl" => "Dutch".to_string(),
        "Svenska" | "Swedish" | "swe" | "sv" => "Swedish".to_string(),
        "Norsk" | "Norwegian" | "nor" | "no" => "Norwegian".to_string(),
        "Dansk" | "Danish" | "dan" | "da" => "Danish".to_string(),
        "Suomi" | "Finnish" | "fin" | "fi" => "Finnish".to_string(),
        "Čeština" | "Czech" | "ces" | "cze" | "cs" => "Czech".to_string(),
        "Magyar" | "Hungarian" | "hun" | "hu" => "Hungarian".to_string(),
        "Română" | "Romanian" | "ron" | "rum" | "ro" => "Romanian".to_string(),
        "Українська" | "Ukrainian" | "ukr" | "uk" => "Ukrainian".to_string(),
        "" => "Unknown".to_string(),
        other => other.to_string(),
    }
}

pub fn strip_emojis(input: &str) -> String {
    input
        .chars()
        .filter(|&c| {
            let u = c as u32;
            !((0x1F000..=0x1FAFF).contains(&u)
                || (0x2600..=0x27BF).contains(&u)
                || (0x2300..=0x23FF).contains(&u)
                || (0x2B00..=0x2BFF).contains(&u)
                || (0xFE00..=0xFE0F).contains(&u)
                || u == 0x200D)
        })
        .collect::<String>()
}

pub fn clean_stream_text(input: &str) -> String {
    let without_emojis = strip_emojis(input);
    let mut cleaned = String::new();
    let mut last_was_space = false;
    for c in without_emojis.chars() {
        if c.is_whitespace() {
            if !last_was_space && !cleaned.is_empty() {
                cleaned.push(' ');
                last_was_space = true;
            }
        } else {
            cleaned.push(c);
            last_was_space = false;
        }
    }
    cleaned.trim().to_string()
}

#[cfg(target_os = "macos")]
pub const CTRL_PREFIX: &str = "^";

#[cfg(not(target_os = "macos"))]
pub const CTRL_PREFIX: &str = "Ctrl+";

pub fn ctrl_key(key: &str) -> String {
    format!("{CTRL_PREFIX}{key}")
}

pub fn wrap_text(text: &str, max_width: usize) -> Vec<String> {
    if max_width == 0 {
        return Vec::new();
    }
    let mut lines = Vec::new();
    for raw_line in text.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut current_line = String::new();
        let mut current_len = 0;

        for word in trimmed.split_whitespace() {
            let word_len = width(word);
            if current_len == 0 {
                if word_len > max_width {
                    lines.push(truncate_width(word, max_width));
                } else {
                    current_line.push_str(word);
                    current_len = word_len;
                }
            } else if current_len + 1 + word_len <= max_width {
                current_line.push(' ');
                current_line.push_str(word);
                current_len += 1 + word_len;
            } else {
                lines.push(current_line);
                if word_len > max_width {
                    lines.push(truncate_width(word, max_width));
                    current_line = String::new();
                    current_len = 0;
                } else {
                    current_line = word.to_string();
                    current_len = word_len;
                }
            }
        }
        if !current_line.is_empty() {
            lines.push(current_line);
        }
    }
    lines
}

pub fn is_http_url(source: &str) -> bool {
    let trimmed = source.trim();
    trimmed.starts_with("http://") || trimmed.starts_with("https://")
}

pub fn extract_4digit_year(raw: &str) -> String {
    raw.chars().filter(|c| c.is_ascii_digit()).take(4).collect()
}

pub fn format_duration(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

pub fn format_file_size(bytes: f64) -> String {
    let mb = bytes / 1024.0 / 1024.0;
    if mb >= 1024.0 {
        format!("{:.1}GB", mb / 1024.0)
    } else {
        format!("{:.0}MB", mb)
    }
}

pub fn parse_duration_seconds(d: &str) -> Option<u64> {
    let s = d.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("n/a") {
        return None;
    }
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() == 2 {
            let m: u64 = parts[0].trim().parse().ok()?;
            let s: u64 = parts[1].trim().parse().ok()?;
            return Some(m * 60 + s);
        } else if parts.len() == 3 {
            let h: u64 = parts[0].trim().parse().ok()?;
            let m: u64 = parts[1].trim().parse().ok()?;
            let s: u64 = parts[2].trim().parse().ok()?;
            return Some(h * 3600 + m * 60 + s);
        }
    }
    let mut total = 0u64;
    let mut current_num = String::new();
    let mut found_any = false;
    for c in s.chars() {
        if c.is_ascii_digit() {
            current_num.push(c);
        } else if c == 'h' || c == 'H' {
            if let Ok(n) = current_num.parse::<u64>() {
                total += n * 3600;
                found_any = true;
            }
            current_num.clear();
        } else if c == 'm' || c == 'M' {
            if let Ok(n) = current_num.parse::<u64>() {
                total += n * 60;
                found_any = true;
            }
            current_num.clear();
        } else if c == 's' || c == 'S' {
            if let Ok(n) = current_num.parse::<u64>() {
                total += n;
                found_any = true;
            }
            current_num.clear();
        }
    }
    if !current_num.is_empty() && !found_any {
        if let Ok(n) = current_num.parse::<u64>() {
            total += n * 60;
            found_any = true;
        }
    }
    if found_any && total > 0 {
        Some(total)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_and_parse_duration() {
        assert_eq!(format_duration(3665), "1:01:05");
        assert_eq!(format_duration(125), "2:05");
        assert_eq!(parse_duration_seconds("1:01:05"), Some(3665));
        assert_eq!(parse_duration_seconds("2h 15m"), Some(8100));
        assert_eq!(parse_duration_seconds("45m"), Some(2700));
        assert_eq!(parse_duration_seconds("N/A"), None);
        assert_eq!(parse_duration_seconds(""), None);
    }
}
