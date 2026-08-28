pub fn clean_moviebox_title(raw_title: &str) -> String {
    let mut title = raw_title.trim();
    if title.is_empty() {
        return String::new();
    }

    while title.starts_with('[') {
        if let Some(close_pos) = title.find(']') {
            let remainder = title[close_pos + 1..].trim();
            if !remainder.is_empty() {
                title = remainder;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    if let Some(pos) = title.find('[') {
        if pos > 0 {
            title = title[..pos].trim();
        }
    }

    if let Some(pos) = title.find('(') {
        if pos > 0 {
            let inside = &title[pos + 1..];
            let inside_content = inside.split(')').next().unwrap_or("").trim();
            let is_year = inside_content.len() == 4
                && inside_content.chars().all(|c| c.is_ascii_digit())
                && inside_content
                    .parse::<u32>()
                    .is_ok_and(|y| (1900..=2099).contains(&y));
            if !is_year {
                title = title[..pos].trim();
            }
        }
    }

    if let Some(pos) = title.rfind(" - ") {
        let suffix = title[pos + 3..].to_lowercase();
        let is_tag = suffix.contains("hindi")
            || suffix.contains("tamil")
            || suffix.contains("telugu")
            || suffix.contains("kannada")
            || suffix.contains("malayalam")
            || suffix.contains("bengali")
            || suffix.contains("marathi")
            || suffix.contains("punjabi")
            || suffix.contains("gujarati")
            || suffix.contains("urdu")
            || suffix.contains("english")
            || suffix.contains("spanish")
            || suffix.contains("french")
            || suffix.contains("german")
            || suffix.contains("italian")
            || suffix.contains("japanese")
            || suffix.contains("korean")
            || suffix.contains("chinese")
            || suffix.contains("russian")
            || suffix.contains("portuguese")
            || suffix.contains("turkish")
            || suffix.contains("arabic")
            || suffix.contains("dub")
            || suffix.contains("audio")
            || suffix.contains("multi")
            || suffix.contains("season")
            || (suffix.starts_with('s')
                && suffix[1..].chars().all(|c| c.is_ascii_digit() || c == '-'));
        if is_tag {
            title = title[..pos].trim();
        }
    }

    if let Some(s_idx) = title.rfind(" S") {
        let suffix = &title[s_idx + 2..];
        let is_season = suffix
            .chars()
            .all(|c| c.is_ascii_digit() || c == '-' || c == 'S');
        if is_season && suffix.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            title = title[..s_idx].trim();
        }
    }

    if let Some(s_idx) = title.to_lowercase().rfind(" season ") {
        title = title[..s_idx].trim();
    }

    let cleaned = title
        .trim_end_matches(['-', ':', '_', '.', ' '])
        .trim()
        .to_string();

    if cleaned.is_empty() {
        raw_title.trim().to_string()
    } else {
        cleaned
    }
}

pub fn language_to_code(name: &str) -> Option<&'static str> {
    let lower = name.trim().to_lowercase();
    match lower.as_str() {
        "english" | "en" | "eng" => Some("en"),
        "spanish" | "es" | "spa" | "español" | "castellano" => Some("es"),
        "hindi" | "hi" | "hin" => Some("hi"),
        "french" | "fr" | "fre" | "fra" | "français" => Some("fr"),
        "german" | "de" | "ger" | "deu" | "deutsch" => Some("de"),
        "italian" | "it" | "ita" | "italiano" => Some("it"),
        "japanese" | "ja" | "jpn" | "日本語" => Some("ja"),
        "korean" | "ko" | "kor" | "한국어" => Some("ko"),
        "chinese" | "zh" | "zho" | "chi" | "中文" | "mandarin" | "cantonese" => Some("zh"),
        "portuguese" | "pt" | "por" | "português" => Some("pt"),
        "russian" | "ru" | "rus" | "русский" => Some("ru"),
        "arabic" | "ar" | "ara" | "العربية" => Some("ar"),
        "turkish" | "tr" | "tur" | "türkçe" => Some("tr"),
        "bengali" | "bn" | "ben" | "বাংলা" => Some("bn"),
        "tamil" | "ta" | "tam" | "தமிழ்" => Some("ta"),
        "telugu" | "te" | "tel" | "తెలుగు" => Some("te"),
        "malayalam" | "ml" | "mal" | "മലയാളം" => Some("ml"),
        "kannada" | "kn" | "kan" | "ಕನ್ನಡ" => Some("kn"),
        "marathi" | "mr" | "mar" | "मराठी" => Some("mr"),
        "punjabi" | "pa" | "pan" | "ਪੰਜਾਬੀ" => Some("pa"),
        "gujarati" | "gu" | "guj" | "ગુજરાતી" => Some("gu"),
        "urdu" | "ur" | "urd" | "اردو" => Some("ur"),
        "indonesian" | "id" | "ind" | "bahasa" => Some("id"),
        "thai" | "th" | "tha" | "ไทย" => Some("th"),
        "vietnamese" | "vi" | "vie" | "tiếng việt" => Some("vi"),
        "dutch" | "nl" | "dut" | "nld" | "nederlands" => Some("nl"),
        "polish" | "pl" | "pol" | "polski" => Some("pl"),
        "swedish" | "sv" | "swe" | "svenska" => Some("sv"),
        "danish" | "da" | "dan" | "dansk" => Some("da"),
        "norwegian" | "no" | "nor" | "norsk" => Some("no"),
        "finnish" | "fi" | "fin" | "suomi" => Some("fi"),
        "greek" | "el" | "ell" | "gre" | "ελληνικά" => Some("el"),
        "hebrew" | "he" | "heb" | "עברית" => Some("he"),
        "czech" | "cs" | "cze" | "ces" | "čeština" => Some("cs"),
        "hungarian" | "hu" | "hun" | "magyar" => Some("hu"),
        "romanian" | "ro" | "rum" | "ron" | "română" => Some("ro"),
        "ukrainian" | "uk" | "ukr" | "українська" => Some("uk"),
        "persian" | "fa" | "fas" | "per" | "فارسی" => Some("fa"),
        "tagalog" | "tl" | "fil" | "filipino" => Some("tl"),
        "malay" | "ms" | "msa" | "may" | "melayu" => Some("ms"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_moviebox_title_leading_tags() {
        assert_eq!(
            clean_moviebox_title("[Dub] Attack on Titan"),
            "Attack on Titan"
        );
        assert_eq!(clean_moviebox_title("[1080p] Dune"), "Dune");
        assert_eq!(
            clean_moviebox_title("[RAW] 千と千尋の神隠し"),
            "千と千尋の神隠し"
        );
        assert_eq!(
            clean_moviebox_title("[Dub] [1080p] Solo Leveling"),
            "Solo Leveling"
        );
    }

    #[test]
    fn test_clean_moviebox_title_parentheses_and_years() {
        assert_eq!(
            clean_moviebox_title("(500) Days of Summer"),
            "(500) Days of Summer"
        );
        assert_eq!(clean_moviebox_title("Inception (2010)"), "Inception (2010)");
        assert_eq!(
            clean_moviebox_title("Movie Name (Director's Cut)"),
            "Movie Name"
        );
    }

    #[test]
    fn test_clean_moviebox_title_trailing_brackets_and_tags() {
        assert_eq!(clean_moviebox_title("Dune [2021]"), "Dune");
        assert_eq!(clean_moviebox_title("Movie - Hindi Dub"), "Movie");
        assert_eq!(clean_moviebox_title("Breaking Bad S01"), "Breaking Bad");
        assert_eq!(clean_moviebox_title("Dark Season 2"), "Dark");
    }

    #[test]
    fn test_clean_moviebox_title_empty_and_whitespace() {
        assert_eq!(clean_moviebox_title(""), "");
        assert_eq!(clean_moviebox_title("   "), "");
        assert_eq!(clean_moviebox_title("Interstellar"), "Interstellar");
    }
}
