import { describe, expect, it } from 'vitest';
import { parseSceneFilename } from '../electron/services/sceneReleaseParser';

describe('SceneReleaseParser - Phân tích cú pháp tên file phim các nhóm Rip', () => {
  it('Xử lý chính xác phim có số/năm nằm trong chính Tên Phim (Blade Runner 2049, 2001 A Space Odyssey, 1917)', () => {
    const br = parseSceneFilename(
      'Blade.Runner.2049.2017.IMAX.2160p.UHD.BluRay.REMUX.HDR.DV.HEVC.Atmos-EPSiLON.mkv'
    );
    expect(br.cleanTitle).toBe('Blade Runner 2049');
    expect(br.year).toBe(2017);
    expect(br.resolution).toBe('2160p');
    expect(br.source).toBe('BluRay REMUX');
    expect(br.videoCodec).toBe('HEVC');
    expect(br.audioCodec).toBe('Atmos');
    expect(br.edition).toContain('IMAX');
    expect(br.hdrFormat).toContain('HDR');
    expect(br.hdrFormat).toContain('Dolby Vision');
    expect(br.releaseGroup).toBe('EPSiLON');

    const odyssey = parseSceneFilename(
      '2001.A.Space.Odyssey.1968.1080p.BluRay.x264-SPARKS.mkv'
    );
    expect(odyssey.cleanTitle).toBe('2001 A Space Odyssey');
    expect(odyssey.year).toBe(1968);
    expect(odyssey.resolution).toBe('1080p');
    expect(odyssey.source).toBe('BluRay');
    expect(odyssey.videoCodec).toBe('x264');
    expect(odyssey.releaseGroup).toBe('SPARKS');

    const m1917 = parseSceneFilename('1917.2019.1080p.WEBRip.x264-RARBG.mp4');
    expect(m1917.cleanTitle).toBe('1917');
    expect(m1917.year).toBe(2019);
    expect(m1917.resolution).toBe('1080p');
    expect(m1917.source).toBe('WEBRip');
    expect(m1917.releaseGroup).toBe('RARBG');
  });

  it('Xử lý chuẩn Phim Bộ (TV Series) SxxExx kèm Tên Tập Phim và dịch vụ Streaming', () => {
    const tlou = parseSceneFilename(
      'The.Last.of.Us.S01E03.Long.Long.Time.2160p.HMAX.WEB-DL.DDP5.1.Atmos.DV.H.265-SMURF.mkv'
    );
    expect(tlou.isTvShow).toBe(true);
    expect(tlou.cleanTitle).toBe('The Last of Us');
    expect(tlou.season).toBe(1);
    expect(tlou.episode).toBe(3);
    expect(tlou.episodeTitle).toBe('Long Long Time');
    expect(tlou.resolution).toBe('2160p');
    expect(tlou.source).toBe('WEB-DL');
    expect(tlou.videoCodec).toBe('H.265');
    expect(tlou.audioChannels).toBe('5.1');
    expect(tlou.releaseGroup).toBe('SMURF');

    const boys = parseSceneFilename(
      'The.Boys.2019.S03E01.Payback.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv'
    );
    expect(boys.isTvShow).toBe(true);
    expect(boys.cleanTitle).toBe('The Boys');
    expect(boys.year).toBe(2019);
    expect(boys.season).toBe(3);
    expect(boys.episode).toBe(1);
    expect(boys.episodeTitle).toBe('Payback');
    expect(boys.releaseGroup).toBe('NTb');
  });

  it('Xử lý chuẩn Anime Fansub với dấu ngoặc vuông và mã CRC32', () => {
    const anime = parseSceneFilename(
      '[SubsPlease] Sousou no Frieren - 12 (1080p) [F021A8B1].mkv'
    );
    expect(anime.isTvShow).toBe(true);
    expect(anime.cleanTitle).toBe('Sousou no Frieren');
    expect(anime.episode).toBe(12);
    expect(anime.resolution).toBe('1080p');
    expect(anime.releaseGroup).toBe('SubsPlease');
    expect(anime.crc32).toBe('F021A8B1');

    const animeMovie = parseSceneFilename(
      '[itt] Your Name (2016) [BD 1080p HEVC 10bit FLAC Dual-Audio].mkv'
    );
    expect(animeMovie.cleanTitle).toBe('Your Name');
    expect(animeMovie.year).toBe(2016);
    expect(animeMovie.resolution).toBe('1080p');
    expect(animeMovie.videoCodec).toBe('HEVC');
    expect(animeMovie.audioCodec).toBe('FLAC');
    expect(animeMovie.releaseGroup).toBe('itt');
  });

  it('Xử lý tiền tố web và các tag ngôn ngữ/thuyết minh/phụ đề Việt Nam', () => {
    const vn = parseSceneFilename(
      '[Thuvienhd.com]_Oppenheimer.2023.ViE.IMAX.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-EPSiLON.mkv'
    );
    expect(vn.cleanTitle).toBe('Oppenheimer');
    expect(vn.year).toBe(2023);
    expect(vn.languageTags).toContain('Tiếng Việt (ViE)');
    expect(vn.edition).toContain('IMAX');
    expect(vn.resolution).toBe('1080p');
    expect(vn.source).toBe('BluRay REMUX');
    expect(vn.audioCodec).toBe('DTS-HD MA');
    expect(vn.audioChannels).toBe('5.1');
    expect(vn.releaseGroup).toBe('EPSiLON');
  });

  it('Xử lý tên phim song ngữ có từ khóa AKA', () => {
    const aka = parseSceneFilename(
      'Dao.Pho.Va.Piano.AKA.Peach.Blossom.Pho.and.Piano.2024.1080p.WEB-DL.AAC2.0.H.264-VNRIP.mp4'
    );
    expect(aka.cleanTitle).toBe('Dao Pho Va Piano');
    expect(aka.originalTitle).toBe('Peach Blossom Pho and Piano');
    expect(aka.year).toBe(2024);
    expect(aka.releaseGroup).toBe('VNRIP');
  });

  it('Nhận diện chuẩn mã JAV (SONE-123, FC2-PPV-1234567, sone00123) và lọc rác tên miền @', () => {
    const jav1 = parseSceneFilename('hhd800.com@SONE-123-C.mp4');
    expect(jav1.javCode).toBe('SONE-123');
    expect(jav1.cleanTitle).toBe('SONE-123');
    expect(jav1.isAdult).toBe(true);

    const jav2 = parseSceneFilename('FC2-PPV-4123456.1080p.mp4');
    expect(jav2.javCode).toBe('FC2-PPV-4123456');
    expect(jav2.isAdult).toBe(true);

    const jav3 = parseSceneFilename('sone00256_4k.mp4');
    expect(jav3.javCode).toBe('SONE-256');
    expect(jav3.isAdult).toBe(true);
  });

  it('Nhận diện chuẩn Scene 18+ Âu Mỹ và OnlyFans / Fansly (Site.YY.MM.DD.Title & ISO Date)', () => {
    const ofScene = parseSceneFilename(
      'OnlyFans.24.09.15.Jane.Doe.Beach.Vacation.XXX.1080p.MP4-WRB.mp4'
    );
    expect(ofScene.isAdult).toBe(true);
    expect(ofScene.siteOrStudio).toBe('OnlyFans');
    expect(ofScene.releaseDate).toBe('2024-09-15');
    expect(ofScene.year).toBe(2024);
    expect(ofScene.cleanTitle).toBe('Jane Doe Beach Vacation');

    const creatorIso = parseSceneFilename(
      '[OnlyFans] Jane Doe - 2024-09-15 - Beach Vacation 1080p.mp4'
    );
    expect(creatorIso.isAdult).toBe(true);
    expect(creatorIso.siteOrStudio).toBe('OnlyFans');
    expect(creatorIso.releaseDate).toBe('2024-09-15');
    expect(creatorIso.year).toBe(2024);
    expect(creatorIso.cleanTitle).toBe('Jane Doe Beach Vacation');
  });
});
