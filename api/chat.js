export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const kakaoKey  = process.env.KAKAO_REST_API_KEY;

  if (!openaiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });
  if (!kakaoKey)  return res.status(500).json({ error: 'Kakao API key not configured' });

  const { location, difficulty } = req.body;
  if (!location) return res.status(400).json({ error: '위치를 입력해주세요' });

  const count = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 10 : 5;

  // 1. 카카오 로컬 API — 카페(CE7) + 음식점(FD6) 인기순 검색
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

  let cafes = [], restaurants = [];
  try {
    [cafes, restaurants] = await Promise.all([
      kakaoSearch(location + ' 카페', 'CE7'),
      kakaoSearch(location + ' 맛집', 'FD6'),
    ]);
  } catch (e) {
    return res.status(500).json({ error: '장소 검색 실패: ' + e.message });
  }

  if (cafes.length === 0 && restaurants.length === 0) {
    return res.status(404).json({ error: `"${location}" 주변 장소를 찾지 못했어요. 다른 지역명을 입력해보세요.` });
  }

  // 2. 상호명 목록 포매팅
  const formatList = (places, label) =>
    places.slice(0, 8).map(p => `  - ${p.place_name} (${p.road_address_name || p.address_name})`).join('\n');

  const placeBlock = [
    cafes.length      ? `[카페 인기 TOP ${Math.min(cafes.length, 8)}]\n${formatList(cafes)}`       : '',
    restaurants.length? `[음식점 인기 TOP ${Math.min(restaurants.length, 8)}]\n${formatList(restaurants)}` : '',
  ].filter(Boolean).join('\n\n');

  // 3. GPT 프롬프트 — 상호명 그대로 사용 강제
  const prompt = `아래는 카카오맵에서 "${location}" 인기 장소를 실제로 검색한 결과입니다.

${placeBlock}

이 목록에서 장소를 골라 방문 미션 ${count}개를 만드세요.

[절대 규칙]
1. 미션에 반드시 위 목록의 정확한 상호명을 그대로 넣어야 합니다 (예: "어니언 성수점", "성수연방")
2. "성수동 카페에서" 같이 뭉뚱그린 표현 금지 — 반드시 구체적 상호명 사용
3. 이모지 포함 30자 이내
4. 미션 예시: "☕ 어니언 성수점에서 소금빵 먹기", "🍜 성수연방 맛집에서 점심 즐기기"

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
        temperature: 0.6,
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
