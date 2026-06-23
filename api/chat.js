export default async function handler(req, res) {
  // POST만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { location, difficulty, walkMode } = req.body;

    const count = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 10 : 5;
    const modeLabel = walkMode === 'couple' ? '커플' : walkMode === 'friend' ? '친구' : walkMode === 'family' ? '가족' : '일반';

    const prompt = `당신은 창의적인 도시 탐험 미션 생성기입니다.
장소: ${location}
미션 개수: ${count}개
모드: ${modeLabel}

위 장소에서 할 수 있는 재미있고 구체적인 산책 미션 ${count}개를 만들어주세요.
각 미션은 한 줄로, 번호 없이, 줄바꿈으로 구분해서 주세요.
미션은 실제 그 동네 특색을 반영해야 합니다.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI error' });
    }

    const data = await response.json();
    const text = data.choices[0].message.content.trim();
    const missions = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    res.status(200).json({ missions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
