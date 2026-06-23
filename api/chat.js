export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const kakaoKey  = process.env.KAKAO_REST_API_KEY;

  if (!openaiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });
  if (!kakaoKey)  return res.status(500).json({ error: 'Kakao API key not configured' });

  const { location, difficulty, seed } = req.body;
  if (!location) return res.status(400).json({ error: '위치를 입력해주세요' });

  const count = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 10 : 5;

  // 카카오 로컬 API 검색
  const kakaoSearch = async (query, categoryCode) => {
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.searchParams.set('query', query);
    url.searchParams.set('category_group_code', categoryCode);
    url.searchParams.set('size', '10');
    url.searchParams.set('sort', 'popularity');
    const r = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${kakaoKey}` }
    });
    if (!r.ok) return [];
    const d = await r.json();
    return d.documents || [];
  };

  // Kakao 키 앞 4자리만 로그 (디버깅용)
  console.log('[kakao-key-prefix]', kakaoKey ? kakaoKey.slice(0, 4) + '...(len=' + kakaoKey.length + ')' : 'MISSING');

  const kakaoFetch = async (query) => {
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.searchParams.set('query', query);
    url.searchParams.set('size', '15');
    const r = await fetch(url.toString(), { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
    const text = await r.text();
    if (!r.ok) { console.log('[kakao-error]', r.status, text); return []; }
    return JSON.parse(text).documents || [];
  };

  let cafes = [], restaurants = [];
  try {
    [cafes, restaurants] = await Promise.all([
      kakaoFetch(location + ' 카페'),
      kakaoFetch(location + ' 맛집'),
    ]);
    console.log('[kakao-results]', 'cafes:', cafes.length, 'restaurants:', restaurants.length);
  } catch (e) {
    return res.status(500).json({ error: '장소 검색 실패: ' + e.message });
  }

  if (cafes.length === 0 && restaurants.length === 0) {
    return res.status(404).json({ error: `"${location}" 주변 장소를 찾지 못했어요. 다른 지역명을 입력해보세요.` });
  }

  // 결과 섞기 (매번 다른 순서)
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // 상호명 목록 포매팅 (섞은 후 상위 8개)
  const formatList = (places) =>
    shuffle(places).slice(0, 8).map(p =>
      `  - ${p.place_name} (${p.road_address_name || p.address_name})`
    ).join('\n');

  const placeBlock = [
    cafes.length       ? `[카페]\n${formatList(cafes)}`       : '',
    restaurants.length ? `[음식점]\n${formatList(restaurants)}` : '',
  ].filter(Boolean).join('\n\n');

  // GPT 미션 생성 (seed로 매번 다른 조합 유도)
  const prompt = `아래는 카카오맵에서 "${location}" 인기 장소를 실제로 검색한 결과입니다.
랜덤 시드: ${seed || Date.now()}

${placeBlock}

이 목록에서 장소를 골라 방문 미션 ${count}개를 만드세요.
매번 다른 장소 조합을 선택하고, 미션 내용도 다양하게 변형하세요 (먹기/마시기/즐기기/구경하기/인증샷 찍기 등).

[절대 규칙]
1. 반드시 위 목록의 정확한 상호명을 그대로 넣어야 합니다
2. "성수동 카페에서" 같이 뭉뚱그린 표현 금지 — 반드시 구체적 상호명 사용
3. 이모지 포함 30자 이내
4. 예시: "☕ 어니언 성수점에서 소금빵 먹기", "🍜 XX식당에서 점심 즐기기"

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
{"missions": ["미션1", "미션2", ...]}`;

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
        temperature: 0.9,
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
