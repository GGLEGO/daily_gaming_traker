// 저장 계층 진입점. config.STORAGE 에 따라 json(파일) 또는 mysql 백엔드를 고른다.
// 에이전트·하네스·서버·챗봇은 이 모듈만 쓰고, 어디에 저장되는지는 모른다.
//
// 공통 API (모두 Promise)
//   init()                                   연결/폴더 준비
//   close()
//   features                                 { unlimited: 보관 상한 없음 여부 }
//   loadStore(game, meta, { html })          { game, name, sourceUrl, lastRun, lastSuccess, lastError, newCount, updatedCount, items[] }
//   countItems(game)                         보관 건수
//   getItem(game, id)                        본문 + revisions(메타) 포함 1건, 없으면 null
//   commitRun(game, run)                     수집 1회 결과 반영. run = { meta, store, ops[], events[], startedAt, finishedAt, ok, error, listedCount, newCount, updatedCount, reason }
//                                              ops: { type:'insert', item, kind } | { type:'revise', id, changed, title, html, plainText, summary, contentHash, image } | { type:'meta', id, title, publishedAt, url, image }
//   recordEvents(events)                     변경 이벤트 추가 (수집 밖에서 쓸 때)
//   loadChanges({ limit, type, since })      { updatedAt, total, events[] }
//   search(words, { game, limit })           { total, items[], byGame }  items 에 hits/score/snippet/plain 포함
//   loadDeals() / saveDeals(obj)             Steam 할인 결과
const config = require('../config');

const backend = config.STORAGE === 'mysql' ? require('./mysql') : require('./json');

module.exports = { backend: config.STORAGE, ...backend };
