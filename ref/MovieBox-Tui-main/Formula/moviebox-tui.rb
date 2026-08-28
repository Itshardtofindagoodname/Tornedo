class MovieboxTui < Formula
  VERSION = "0.1.14"
  MACOS_SHA256 = "dafae78848e04678dc736773e3390f7773b24cd7fa98e0385f29e483dd6bc389"
  LINUX_X64_SHA256 = "94279263008b9f843b6981880e733ca0a4d1387ed7597f7604518be57f3dce72"
  LINUX_ARM64_SHA256 = "d588b1dee1c484950bf33d89ce69bf71c3f99221795aa0b0250a5e935f5a7166"

  desc "Stream movies, shows, anime, and live TV from your terminal"
  homepage "https://github.com/mesamirh/MovieBox-Tui"
  version VERSION
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_macOS_Universal.tar.gz"
    sha256 MACOS_SHA256
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_Linux_arm64.tar.gz"
      sha256 LINUX_ARM64_SHA256
    else
      url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_Linux_x64.tar.gz"
      sha256 LINUX_X64_SHA256
    end
  end

  def install
    bin.install "moviebox-tui"
  end

  test do
    system "#{bin}/moviebox-tui", "--version"
  end
end
