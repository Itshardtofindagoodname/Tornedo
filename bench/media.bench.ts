/**
 * Title-parsing and audio-metadata throughput.
 */
import { bench, describe } from "vitest";
import { parseTitle } from "../src/media/title.js";
import { parseAudio } from "../src/media/audio.js";

const SCENE_TITLES = [
  "Interstellar.2014.1080p.BluRay.x264-RARBG",
  "Game.Of.Thrones.S08E03.720p.HDTV.x264-KILLERS",
  "Dune.2021.2160p.4K.UHD.BluRay.HEVC.TrueHD.7.1",
  "The.Mandalorian.S02E08.2160p.DV.WEB-DL.H265.DDP5.1",
  "Cyberpunk.2077.Repack.by.FitGirl",
  "Radiohead-OK Computer-1997-FLAC-24bit-192kHz",
  "Stranger Things Season 4 1080p WEB-DL",
  "Blade Runner 2049 Extended Cut 1080p BluRay x264",
  "Elite S01 1080p Spanish WEB-DL multi subs",
  "Some Book Audiobook Unabridged MP3 VBR",
];

describe("parseTitle", () => {
  bench("parse 10 scene titles", () => {
    for (const t of SCENE_TITLES) parseTitle(t);
  });
});

describe("parseAudio", () => {
  bench("parse audio tags", () => {
    for (const t of SCENE_TITLES) parseAudio(t);
  });
});