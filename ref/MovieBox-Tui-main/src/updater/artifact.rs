#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Release {
    pub version: String,
    pub tag_name: String,
    pub notes: String,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetPlatform {
    MacosUniversal,
    LinuxX64,
    LinuxArm64,
    WindowsX64,
    WindowsArm64,
}

impl TargetPlatform {
    pub fn current() -> Option<Self> {
        Self::detect(
            std::env::consts::OS,
            std::env::consts::ARCH,
            is_termux_environment(),
        )
    }

    pub fn detect(os: &str, arch: &str, is_termux: bool) -> Option<Self> {
        if is_termux {
            if arch == "aarch64" || arch == "arm64" {
                return Some(Self::LinuxArm64);
            } else {
                return None;
            }
        }

        match os {
            "macos" | "darwin" => Some(Self::MacosUniversal),
            "linux" => match arch {
                "x86_64" | "x86-64" | "x64" | "amd64" => Some(Self::LinuxX64),
                "aarch64" | "arm64" => Some(Self::LinuxArm64),
                _ => None,
            },
            "windows" => match arch {
                "x86_64" | "x86-64" | "x64" | "amd64" => Some(Self::WindowsX64),
                "aarch64" | "arm64" => Some(Self::WindowsArm64),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn expected_asset_name(self) -> &'static str {
        match self {
            Self::MacosUniversal => "MovieBox_macOS_Universal.tar.gz",
            Self::LinuxX64 => "MovieBox_Linux_x64.tar.gz",
            Self::LinuxArm64 => "MovieBox_Linux_arm64.tar.gz",
            Self::WindowsX64 => "MovieBox_Windows_x64.zip",
            Self::WindowsArm64 => "MovieBox_Windows_arm64.zip",
        }
    }

    pub fn expected_binary_name(self) -> &'static str {
        match self {
            Self::WindowsX64 | Self::WindowsArm64 => "moviebox-tui.exe",
            _ => "moviebox-tui",
        }
    }
}

pub fn is_termux_environment() -> bool {
    std::env::var("PREFIX").is_ok_and(|p| p.contains("com.termux"))
}

impl Release {
    pub fn find_compatible_asset(&self, platform: TargetPlatform) -> Option<&ReleaseAsset> {
        let expected = platform.expected_asset_name();
        self.assets.iter().find(|a| a.name == expected)
    }

    pub fn find_checksum_asset(&self) -> Option<&ReleaseAsset> {
        self.assets.iter().find(|a| a.name == "SHA256SUMS")
    }

    pub fn is_compatible_with_current_platform(&self) -> bool {
        TargetPlatform::current()
            .and_then(|p| self.find_compatible_asset(p))
            .is_some()
    }
}
