const https = require('https');

exports.handler = async function(event, context) {
  console.log('=== 函数调用开始 ===');
  
  // 处理OPTIONS预检请求
  if (event.httpMethod === 'OPTIONS') {
    console.log('处理OPTIONS请求');
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
    console.log('不接受的方法:', event.httpMethod);
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
    console.log('解析请求体...');
    
    // 解析请求体
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      console.error('JSON解析错误:', e.message);
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
      console.log('消息为空');
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
    
    console.log('收到消息:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));
    
    // 从环境变量获取API密钥
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) {
      console.error('❌ DEEPSEEK_API_KEY环境变量未设置');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: false,
          error: '服务器配置错误',
          message: 'DEEPSEEK_API_KEY环境变量未设置。请在Netlify环境变量中设置。'
        })
      };
    }
    
    console.log('✅ API密钥已获取，长度:', apiKey.length);
    
    // 测试API密钥格式
    if (!apiKey.startsWith('sk-')) {
      console.error('❌ API密钥格式可能不正确');
    }
    
    // 调用DeepSeek API
    console.log('正在调用DeepSeek API...');
    const deepseekResponse = await callDeepSeekAPI(apiKey, message);
    console.log('✅ DeepSeek API调用成功');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(deepseekResponse)
    };
    
  } catch (error) {
    console.error('❌ 函数执行错误:', error.message);
    console.error('错误堆栈:', error.stack);
    
    // 根据错误类型返回不同的信息
    let userMessage = '服务器内部错误';
    let details = error.message;
    
    if (error.message.includes('401')) {
      userMessage = 'API密钥无效或已过期';
    } else if (error.message.includes('429')) {
      userMessage = 'API调用频率超限';
    } else if (error.message.includes('timeout')) {
      userMessage = '请求超时，请稍后重试';
    } else if (error.message.includes('ENOTFOUND')) {
      userMessage = '无法连接到API服务器';
    }
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: userMessage,
        details: details,
        help: '请检查API密钥和网络连接'
      })
    };
  }
};

// 调用DeepSeek API的辅助函数
function callDeepSeekAPI(apiKey, userMessage) {
  return new Promise((resolve, reject) => {
    const systemPrompt = `你是专业的英语AI教师助手。请用中英双语回复。用户用英文提问时，先用英文详细回答，然后提供中文翻译。`;
    
    const postData = JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { 
          role: "system", 
          content: systemPrompt 
        },
        { 
          role: "user", 
          content: userMessage 
        }
      ],
      max_tokens: 800,
      temperature: 0.7,
      stream: false
    });

    console.log('请求数据大小:', Buffer.byteLength(postData), '字节');
    
    const options = {
      hostname: 'api.deepseek.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 25000 // 25秒超时
    };

    console.log('发送HTTPS请求到DeepSeek API...');
    
    const req = https.request(options, (res) => {
      console.log('DeepSeek API响应状态:', res.statusCode);
      
      let data = '';
      let responseSize = 0;

      res.on('data', (chunk) => {
        data += chunk;
        responseSize += chunk.length;
      });

      res.on('end', () => {
        console.log('收到响应，大小:', responseSize, '字节');
        
        try {
          if (res.statusCode !== 200) {
            console.error('DeepSeek API错误状态:', res.statusCode);
            console.error('错误响应:', data.substring(0, 500));
            
            let errorMsg = `DeepSeek API返回状态 ${res.statusCode}`;
            try {
              const errorJson = JSON.parse(data);
              if (errorJson.error && errorJson.error.message) {
                errorMsg = errorJson.error.message;
              }
            } catch (e) {
              // 忽略解析错误
            }
            
            reject(new Error(errorMsg));
            return;
          }
          
          console.log('解析API响应...');
          const jsonData = JSON.parse(data);
          
          if (!jsonData.choices || !jsonData.choices[0] || !jsonData.choices[0].message) {
            console.error('无效的API响应格式:', jsonData);
            reject(new Error('DeepSeek API返回了无效的响应格式'));
            return;
          }
          
          const aiContent = jsonData.choices[0].message.content;
          console.log('AI回复长度:', aiContent.length);
          
          // 简单处理响应
          let englishPart = aiContent;
          let chinesePart = "中文翻译";
          
          // 尝试提取中文部分
          const chineseMatch = aiContent.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5\s，。！？、：；""''（）《》【】]*$/);
          if (chineseMatch) {
            englishPart = aiContent.substring(0, chineseMatch.index).trim();
            chinesePart = chineseMatch[0].trim();
          } else {
            // 如果没有明显的中文部分，使用整个内容
            englishPart = aiContent;
            chinesePart = "请参考上面的英文解释";
          }
          
          console.log('✅ 成功处理响应');
          
          resolve({
            success: true,
            text: englishPart,
            translation: chinesePart
          });
          
        } catch (parseError) {
          console.error('解析响应失败:', parseError.message);
          console.error('原始响应:', data.substring(0, 500));
          reject(new Error(`解析API响应失败: ${parseError.message}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('HTTPS请求错误:', error.message);
      reject(new Error(`网络请求失败: ${error.message}`));
    });

    req.on('timeout', () => {
      console.error('请求超时');
      req.destroy();
      reject(new Error('请求超时，请稍后重试'));
    });

    // 发送请求
    req.write(postData);
    req.end();
  });
}