export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const kakaoKey  = process.env.KAKAO_REST_API_KEY;

  if (!openaiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  const { location, difficulty } = req.body;
  if (!location) return res.status(400).json({ error: '위치를 입력해주세요' });

  const count = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 10 : 5;

  // 1. 카카오 로컬 API로 실제 장소 검색 (카페 + 관광명소)
  let placeContext = '';
  if (kakaoKey) {
    try {
      const headers = { Authorization: `KakaoAK ${kakaoKey}` };
      const fetches = [
        fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(location + ' 카페')}&category_group_code=CE7&size=7&sort=popularity`, { headers }),
        fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(location + ' 관광명소')}&category_group_code=AT4&size=5&sort=popularity`, { headers }),
        fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(location + ' 맛집')}&category_group_code=FD6&size=5&sort=popularity`, { headers }),
      ];
      const results = await Promise.all(fetches);
      const places = [];
      for (const r of results) {
        if (r.ok) {
          const d = await r.json();
          places.push(...(d.documents || []));
        }
      }

      // 중복 제거
      const seen = new Set();
      const unique = places.filter(p => {
        if (seen.has(p.place_name)) return false;
        seen.add(p.place_name);
        return true;
      });

      if (unique.length > 0) {
        placeContext = `\n\n[${location} 실제 인기 장소 목록 — 이 장소들을 미션에 반드시 활용하세요]\n` +
          unique.slice(0, 15).map(p =>
            `• ${p.place_name} / ${p.category_name.split(' > ').pop()} / ${p.road_address_name || p.address_name}`
          ).join('\n');
      }
    } catch (e) {
      // 카카오 API 실패 시 GPT만으로 진행
    }
  }

  // 2. GPT로 방문 미션 생성
  const prompt = `당신은 즐거운 도시 탐험 미션 전문가입니다.
지역: ${location}
미션 개수: ${count}개
${placeContext}

규칙:
- 위 장소 목록에서 실제 장소명을 골라 방문·체험하는 미션을 만드세요
- 장소가 없으면 ${location}의 잘 알려진 실제 명소를 사용하세요
- 각 미션은 이모지 포함 20자 이내, 구체적이고 실행 가능하게
- 예시: "☕ 홍익커피 아이스아메리카노 마시기", "🏛 구리타워 꼭대기 사진 찍기"

반드시 아래 JSON 형식으로만 응답하세요:
{"missions": ["미션1", "미션2"]}`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 600
      })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'OpenAI error' });
    }

    const data = await r.json();
    const text = data.choices[0].message.content.trim();
    const json = JSON.parse(text);
    res.status(200).json({ missions: json.missions.slice(0, count) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
