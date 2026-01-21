const https = require('https');

exports.handler = async function(event, context) {
  console.log('收到请求:', event.httpMethod);
  
  // 处理OPTIONS预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }
  
  // 只接受POST请求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: false,
        error: '只允许POST请求' 
      })
    };
  }
  
  try {
    // 解析请求体
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: '无效的JSON格式' 
        })
      };
    }
    
    const { message } = body;
    
    if (!message || message.trim() === '') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: '消息不能为空' 
        })
      };
    }
    
    console.log('处理消息:', message.substring(0, 50) + '...');
    
    // 从环境变量获取API密钥（安全！）
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) {
      console.error('DEEPSEEK_API_KEY环境变量未设置');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: '服务器配置错误',
          message: '请设置DEEPSEEK_API_KEY环境变量'
        })
      };
    }
    
    console.log('API密钥已获取，长度:', apiKey.length);
    
    // 调用DeepSeek API
    const deepseekResponse = await callDeepSeekAPI(apiKey, message);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(deepseekResponse)
    };
    
  } catch (error) {
    console.error('处理请求时出错:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: '服务器内部错误',
        details: error.message
      })
    };
  }
};

// 调用DeepSeek API
function callDeepSeekAPI(apiKey, userMessage) {
  return new Promise((resolve, reject) => {
    const systemPrompt = `你是专业的英语AI教师助手。用户只能用英文向你提问。你的任务是：

1. 提供详细、有帮助的英语学习内容
2. 给出具体例句和使用场景
3. 提供完整的中文翻译
4. 鼓励和教育性的语气
5. 回复要全面但简洁

请按以下格式回复：
[英文回复内容，包含详细解释和例句]

然后在最后添加：
<div class="translation">[对应的中文翻译]</div>`;

    const postData = JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_tokens: 1000,
      temperature: 0.7,
      stream: false
    });

    const options = {
      hostname: 'api.deepseek.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.error('DeepSeek API错误:', res.statusCode, data);
            reject(new Error(`DeepSeek API返回状态 ${res.statusCode}`));
            return;
          }
          
          const jsonData = JSON.parse(data);
          
          if (!jsonData.choices || !jsonData.choices[0] || !jsonData.choices[0].message) {
            reject(new Error('DeepSeek API返回格式异常'));
            return;
          }
          
          const aiContent = jsonData.choices[0].message.content;
          
          // 提取翻译
          let englishPart = aiContent;
          let chinesePart = "中文翻译";
          
          if (aiContent.includes('<div class="translation">')) {
            const parts = aiContent.split('<div class="translation">');
            englishPart = parts[0].trim();
            chinesePart = parts[1].replace('</div>', '').trim();
          } else {
            const lines = aiContent.split('\n');
            if (lines.length > 1) {
              englishPart = lines.slice(0, -1).join('\n').trim();
              chinesePart = lines[lines.length - 1].trim();
            }
          }
          
          resolve({
            success: true,
            text: englishPart,
            translation: chinesePart
          });
          
        } catch (parseError) {
          console.error('解析DeepSeek响应失败:', parseError);
          reject(new Error('解析API响应失败'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('HTTP请求失败:', error);
      reject(new Error(`HTTP请求失败: ${error.message}`));
    });

    req.on('timeout', () => {
      console.error('请求超时');
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.write(postData);
    req.end();
  });
}