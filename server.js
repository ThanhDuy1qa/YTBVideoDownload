const express = require('express');
const ytSearch = require('yt-search');
const { spawn } = require('child_process');
const fs = require('fs'); // Thêm thư viện fs để kiểm tra file cookies nếu có
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Helper bóc tách Video ID từ URL YouTube
function getYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// 1. API Tìm kiếm từ khóa (yt-search)
// ==========================================
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm' });

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const r = await ytSearch(query);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const videos = r.videos.slice(startIndex, endIndex).map(v => ({
      id: v.videoId,
      url: v.url,
      title: v.title,
      thumbnail: v.thumbnail,
      duration: v.timestamp,
      author: v.author.name
    }));

    res.json({ type: 'search', videos, hasMore: endIndex < r.videos.length });
  } catch (err) {
    console.error('Lỗi search:', err);
    res.status(500).json({ error: 'Lỗi hệ thống khi tìm kiếm dữ liệu.' });
  }
});

// ==========================================
// 2. API Tải Xuống Trực Tiếp (Piped API + Fallback Auto)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  // Danh sách các máy chủ Piped API hoạt động ổn định nhất
  const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://piped-api.garudalinux.org',
    'https://api.piped.projectsegfau.lt'
  ];

  let data = null;

  // Vòng lặp thử từng máy chủ, nếu server lỗi sẽ tự động chuyển sang server tiếp theo
  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(4000) // Giới hạn chờ 4s cho mỗi server
      });

      if (response.ok) {
        data = await response.json();
        break; // Lấy dữ liệu thành công, thoát vòng lặp
      }
    } catch (e) {
      console.log(`Server ${instance} gặp lỗi/bận, đang thử server tiếp theo...`);
    }
  }

  if (!data) {
    return res.status(500).send('Tất cả máy chủ xử lý đều bận. Vui lòng thử lại sau ít phút.');
  }

  try {
    const isMp3 = format === 'mp3';
    let targetStream;

    if (isMp3) {
      // Chọn stream audio chất lượng cao nhất
      targetStream = data.audioStreams?.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    } else {
      // Chọn stream video có sẵn tiếng
      targetStream = data.videoStreams?.find(v => v.videoOnly === false) || data.videoStreams?.[0];
    }

    if (targetStream && targetStream.url) {
      return res.redirect(targetStream.url);
    } else {
      return res.status(500).send('Không tìm thấy luồng dữ liệu phù hợp.');
    }
  } catch (err) {
    console.error('Lỗi xử lý luồng stream:', err);
    return res.status(500).send('Lỗi máy chủ khi xử lý file.');
  }
});

// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});