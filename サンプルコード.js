function doPost(e) { 
  const props = PropertiesService.getScriptProperties()
  // キーやトークンはスクリプトプロパティで指定する
  const OPENAI_API_KEY = props.getProperty('OPENAI_API_KEY')
  const LINE_TOKEN     = props.getProperty('LINE_TOKEN')

  const event = JSON.parse(e.postData.contents).events[0]

  // ユーザの発言
  const userMessage = event.message.text
  if (userMessage === undefined) {
    // スタンプなどが送られてきた時
    userMessage = 'やあ'
  }

  // botが覚えている内容を取得
  const botMemoryText = getBotMemoryText();
  // 会話履歴を取得
  const messageHistoryText = getMessageHistoryText();

  // ユーザの発言をスプレッドシートに記録
  recordMessage("User", userMessage);

  // ChatGPTでボットの発言を生成
  const botMessage = generateBotMessage(userMessage, messageHistoryText, botMemoryText, OPENAI_API_KEY)

  // ユーザの発言から「覚えておくべきもの」をChatGPTに抽出させる
  const userPersonalDate = extractUserPersonalData(userMessage, OPENAI_API_KEY)
  // ChatGPTが抽出した内容をスプレッドシートに記録
  recordUserPersonalDate(userPersonalDate)
  // ボットの発言をスプレッドシートに記録
  recordMessage("Chatbot", botMessage);

  // LINE送信
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + LINE_TOKEN,
    },
    'method': 'post',
    'payload': JSON.stringify({
      'replyToken': event.replyToken,
      'messages': [{
        'type': 'text',
        'text': botMessage,
      }]
    })
  })
}

// スプレッドシートからbotが記憶している内容を取得し、文字列で返す
function getBotMemoryText() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('botMemories');
  if (!sheet) {
    return "";
  }

  var sheetValues = sheet.getDataRange().getValues();
  var botMemories = "";
  sheetValues.forEach(function(row) {
    botMemories += "事柄:" + row[0] + " 内容: " + row[1] + " 補足:" + row[2] + "\n";
  });
  return botMemories;
}

// スプレッドシートからチャット履歴を取得し、文字列で返す
function getMessageHistoryText() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('histories');
  if (!sheet) {
    return "過去の発言はありません";
  }

  var data = sheet.getDataRange().getValues();
  // 最後の6行だけを取り出す
  // 行数を指定せずに際限なく
  var start = Math.max(0, data.length - 6);
  var slicedData = data.slice(start);
  var history = "";
  slicedData.forEach(function(row) {
    history += row[1] + ": " + row[2] + "\n";
  });
  return history;
}

// メッセージをスプレッドシートに記録する関数
function recordMessage(sender, message) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('histories');
  sheet.appendRow([new Date(), sender, message]);
}

function extractUserPersonalData(userMessage, openAiKey) {
  const requestOptions = {
      "method": "post",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer "+ openAiKey
      },
      "payload": JSON.stringify({
        "model": "gpt-4",
        // "model": "gpt-3.5-turbo",
        "messages": [
          {"role": "system", "content": `
          以下の###で囲まれた内容はユーザの発言です。
  
          ### 
          ${userMessage}
          ### 
          `
          },
         ],
         "functions": [
                {
                  "name": "extract_personality",
                  "description": `
                    あなたは会話LINEbotです。ユーザとあなたというキャラクター同士で友好的なコミュニケーションを取るために、
                    ユーザの発言からあなたが「長期記憶しておくべき情報」と判断したものをJSON配列で抽出してください。\n
                    「長期記憶しておくべき情報」が無いと判断した場合、何も抽出しないでください。\n
                    下記は「長期記憶しておくべき情報」として相応しい例です。\n
                    ・ユーザの趣味嗜好\n
                    ・ユーザが固有に定義した事柄\n
                    ・あなたの発言や振る舞い対する指示\n
                    \n
                    下記は「長期記憶しておくべき情報」として相応しくない例です。\n
                    ・何気ない会話内容\n
                    ・単なるリアクション\n
                    \n
                  `,
                  "parameters": {
                      "type": "object",
                      "properties": {
                          "persons": {
                            "type": "array",
                            "description": "長期記憶しておくべき情報",
                            "items": {
                              "type": "object",
                              "properties": {
                                "title": {
                                    "type": "string",
                                    "description": "長期記憶しておくべき情報の題名です",
                                },
                                "content": {
                                    "type": "string",
                                    "description": "長期記憶しておくべき情報の内容です",
                                },
                                "tips": {
                                    "type": "string",
                                    "description": "長期記憶しておくべき情報の内容の補足です。必要なければ空白です。",
                                },
                              },
                            },
                          },
                      },
                  },
                },
              ],
          "function_call": {
            "name": "extract_personality",
          },
      })
    }
    const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions)
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);
    const userData = json['choices'][0]['message']['function_call']['arguments'];
    return userData
}

function generateBotMessage(userMessage, messageHistoryText, botMemoryText, apiKey) {
  const requestOptions = {
      "method": "post",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer "+ apiKey
      },
      "payload": JSON.stringify({
        "model": "gpt-4",
        // "model": "gpt-3.5-turbo",
        "messages": [
          {"role": "system", "content": `
  あなたはChatbotとして、会話LINEbot「ネコタロー」のロールプレイを行います。\n
  以下の制約条件を守ってロールプレイを行ってください。 ただし、Userから指示があった場合、下記の内容よりもUserが指示した制約条件や性格・口調を優先してください。\n

  制約条件: \n
  * Chatbotの自身を示す一人称は、僕です。 \n
  * Userを示す二人称は、君です。 \n
  * Chatbotの名前は、ネコタローです。 \n
  * ネコタローは確固たる情報を持たないLINEbotです。\n
  * Userへの返答は２〜3文程度の簡潔かつ端的なものにしてください。\n
\n
  ネコタローのセリフ、口調の例: \n
  * 僕はネコタローだニャ。よろしくニャ。\n
  * 疲れたのかにゃ？元気だすニャ。いいことあるニャ。\n
\n
` + `以下に添付するのは、ChatbotとUserの会話履歴です\n` + messageHistoryText+ `\n
  以下に添付するのは、ChatbotとUserとのやり取りの中で「覚えておくべき」と判断した記録です。会話の中で、必要に応じてこれらの記録を参照してください。また、Chatbotの制約条件や口調、セリフなどは、先に示したものよりも、記録の指示を優先して従ってください。\n
          ` + botMemoryText},
          {"role": "user", "content": userMessage}
        ]
      })
    }
    const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions)
    const responseText = response.getContentText();
    const json = JSON.parse(responseText);
    return json['choices'][0]['message']['content'].trim();
}

function recordUserPersonalDate(data) {
  const jsonData = JSON.parse(data)

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('botMemories');

  // personsの配列をループして、各要素のデータをスプレッドシートに追加
  for (let i = 0; i < jsonData["persons"].length; i++) {
    const person = jsonData["persons"][i];

    // A列にtitle, B列にcontent, C列にtipsを格納
    sheet.appendRow([person["title"], person["content"], person["tips"]]);
  }
}
