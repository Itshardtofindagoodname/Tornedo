use std::fs;
use std::path::PathBuf;

const TRACKER_LUA_CONTENT: &str = r#"local options = require 'mp.options'

local opts = {
    provider = "",
    subject_id = "",
    season = 0,
    episode = 0,
    state_file = "",
}
options.read_options(opts, "moviebox")

local last_pos = 0
local last_dur = 0

mp.observe_property("time-pos", "number", function(name, val)
    if val then
        last_pos = val
    end
end)

mp.observe_property("duration", "number", function(name, val)
    if val then
        last_dur = val
    end
end)

local function write_state(force_completed)
    if opts.state_file == "" then return end
    if last_dur <= 0 and last_pos <= 0 then return end

    local completed = force_completed or (last_dur > 0 and last_pos >= (0.90 * last_dur))
    local now = os.time()

    local json = string.format(
        '{"provider":%q,"subject_id":%q,"season":%d,"episode":%d,"progress_seconds":%d,"duration_seconds":%d,"completed":%s,"timestamp":%d}',
        opts.provider,
        opts.subject_id,
        tonumber(opts.season) or 0,
        tonumber(opts.episode) or 0,
        math.floor(last_pos + 0.5),
        math.floor(last_dur + 0.5),
        completed and "true" or "false",
        now
    )

    local f = io.open(opts.state_file, "w")
    if f then
        f:write(json)
        f:close()
    end
end

mp.register_event("end-file", function(event)
    if event and event.reason == "eof" then
        write_state(true)
    end
end)

mp.register_event("shutdown", function()
    write_state(false)
end)

mp.add_periodic_timer(5, function()
    write_state(false)
end)
"#;

pub fn ensure_tracker_script() -> Option<PathBuf> {
    let dir = crate::config::scripts_dir()?;
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    let path = dir.join("moviebox_tracker.lua");
    if !path.exists()
        || fs::read_to_string(&path)
            .map(|c| c != TRACKER_LUA_CONTENT)
            .unwrap_or(true)
    {
        let _ = fs::write(&path, TRACKER_LUA_CONTENT.as_bytes());
    }
    Some(path)
}

pub fn state_file_path(
    provider: &str,
    subject_id: &str,
    season: usize,
    episode: usize,
) -> Option<PathBuf> {
    let dir = crate::config::playback_state_dir()?;
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    let sanitized_provider = sanitize_component(provider);
    let sanitized_id = sanitize_component(subject_id);
    let filename = format!("{sanitized_provider}_{sanitized_id}_{season}_{episode}.json");
    Some(dir.join(filename))
}

fn sanitize_component(value: &str) -> String {
    value.replace(['/', '\\', ':', ' '], "_")
}

#[cfg(test)]
mod tests {
    use super::sanitize_component;

    #[test]
    fn state_file_components_are_safe_for_filenames() {
        assert_eq!(
            sanitize_component("provider/with\\separators"),
            "provider_with_separators"
        );
        assert_eq!(
            sanitize_component("subject:with space"),
            "subject_with_space"
        );
    }
}
