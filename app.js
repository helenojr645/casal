// App do casal (Heleno & Ma). Tela -> motor.js/divisao.js calculam na hora; operacoes.js aplica a mudanca
// no celular na mesma hora (sem esperar a internet) e o servidor confirma. Sem nenhum valor real neste arquivo.
(function () {
  'use strict';
  var M = window.Motor, Div = window.Divisao, Op = window.Operacoes, API = window.API_URL;
  var NOME = { heleno: 'Heleno', ma: 'Ma' }, COR = { heleno: 'var(--heleno)', ma: 'var(--ma)', casa: 'var(--casa)' };
  var MES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  var SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  var S = { token: null, pessoa: null, servidor: null, versao: 0, fila: [], estado: null, historico: [], aba: 'mes', mes: null, simular: false, calc: null, enviando: false, erroRede: false };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- utilidades ----------
  function brl(v) { if (v == null) return '—'; var s = Math.abs(v).toFixed(2).split('.'); return (v < -0.004 ? '−' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1]; }
  function brl0(v) { return brl(v).replace(/,\d\d$/, ''); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function ddmm(s) { return s.slice(8, 10) + '/' + s.slice(5, 7); }
  function semana(s) { return SEMANA[new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).getUTCDay()]; }
  function nomeMes(m) { return MES_NOME[+m.slice(5, 7) - 1] + (m.slice(0, 4) !== hoje().slice(0, 4) ? ' ' + m.slice(0, 4) : ''); }
  function curtoMes(m) { return MES_CURTO[+m.slice(5, 7) - 1]; }
  function lerValor(txt) {
    txt = String(txt || '').replace(/[R$\s]/g, '');
    if (!txt) return null;
    if (txt.indexOf(',') >= 0) txt = txt.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(txt)) txt = txt.replace(/\./g, ''); // 1.500 = mil e quinhentos
    var v = Number(txt); return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : NaN;
  }
  function paraCampo(v) { return v == null ? '' : v.toFixed(2).replace('.', ','); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function cicloDia() { return (S.estado.divisao && S.estado.divisao.cicloDia) || 30; }
  function cicloDe(d) { var m = d.slice(0, 7), cs = M.ciclos([m, M.somaMeses(m, 1)], { dia: cicloDia() }); return d >= cs[1].de ? cs[1].id : cs[0].id; }
  function regra(id) { for (var i = 0; i < S.estado.regras.length; i++) if (S.estado.regras[i].id === id) return S.estado.regras[i]; return null; }
  function donoDe(mv) { if (mv.regra) { var r = regra(mv.regra); return r ? (r.dono || (r.caixa === 'ma' ? 'ma' : 'heleno')) : 'heleno'; } return mv.casa ? 'casa' : mv.caixa; }

  // ---------- servidor ----------
  function api(q) {
    var ctrl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctrl) ctrl.abort(); }, 45000);
    return fetch(API, { method: 'POST', body: JSON.stringify(q), signal: ctrl && ctrl.signal, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('rede'); return r.json(); })
      .finally(function () { clearTimeout(tm); });
  }
  function sessaoCaiu(r) { return r && r.erro && /Sessão expirada/.test(r.erro); }

  // estado mostrado = ultimo estado do servidor + mudancas ainda a caminho (aparecem na hora)
  function recompor() {
    var e = clone(S.servidor);
    S.fila.forEach(function (f) { try { Op.aplicar(e, f.op); } catch (x) { /* ja nao se aplica: o servidor vai recusar */ } });
    S.estado = e; S.calc = null;
  }
  function operar(op, depois) {
    op = Object.assign({}, op, { autor: S.pessoa });
    // o id do que e criado nasce aqui, uma vez so: celular e servidor usam o mesmo (apagar logo depois funciona)
    if ((op.tipo === 'avulso' || op.tipo === 'novaConta') && !op.id) op.id = (op.tipo === 'avulso' ? 'av-' : 'ct-') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try { Op.aplicar(clone(S.estado), op); } catch (x) { toast(x.message, true); return false; }
    op.opId = 'op-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    S.fila.push({ op: op, depois: depois });
    guardarFila(); seguro(function () { recompor(); render(); }); marcaSync();
    enviarFila();
    return true;
  }
  // a fila fica guardada no aparelho: se a internet cair, o app fechar ou a sessao expirar, nada se perde
  function chaveFila() { return 'casal-fila-' + (S.pessoa || L.pessoa); }
  function guardarFila() { try { localStorage.setItem(chaveFila(), JSON.stringify(S.fila.map(function (f) { return { op: f.op }; }))); } catch (x) {} }
  function lerFila(p) { try { return JSON.parse(localStorage.getItem('casal-fila-' + p) || '[]'); } catch (x) { return []; } }
  var tentaDeNovo = null, espera = 3000;
  function enviarFila() {
    if (S.enviando || !S.fila.length || !S.token) return;
    clearTimeout(tentaDeNovo);
    S.enviando = true; marcaSync();
    var item = S.fila[0];
    api({ acao: 'operar', token: S.token, op: item.op }).then(function (r) {
      S.enviando = false; S.erroRede = false; espera = 3000;
      if (sessaoCaiu(r)) return sair('Sua sessão expirou. Digite o PIN: ' + S.fila.length + ' mudança(s) guardada(s) serão enviadas em seguida.');
      S.fila.shift(); guardarFila();
      if (r.estado) { S.servidor = r.estado; S.versao = r.versao; }
      if (r.erro) toast(r.erro, true);
      else if (!r.repetida) {
        S.historico.unshift({ quando: agoraLocal(), quem: NOME[S.pessoa], texto: r.texto });
        if (item.depois) { try { item.depois(r); } catch (x) {} } else toast('Salvo');
      }
      seguro(function () { recompor(); render(); }); marcaSync(); enviarFila();
    }, function () {
      // sem resposta: pode ter salvo ou nao. Mantem na fila e reenvia com o MESMO opId (o servidor nao aplica 2 vezes)
      S.enviando = false;
      if (!S.erroRede) toast('Sem internet: guardei a mudança e envio sozinho quando a conexão voltar.', true);
      S.erroRede = true; marcaSync();
      tentaDeNovo = setTimeout(enviarFila, espera); espera = Math.min(espera * 2, 30000);
    });
  }
  function agoraLocal() { var d = new Date(); return hoje() + 'T' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // nada que der errado no desenho pode travar a fila (a mudanca ja esta guardada e segue para o servidor)
  function seguro(fn) { try { fn(); } catch (x) { console.error(x); try { $('tela').innerHTML = '<div class="alerta"><p><b>Algo não fechou na conta deste mês.</b> Os dados estão salvos. Avise o Heleno.</p></div>'; } catch (y) {} } }
  function marcaSync() {
    var b = $('sync'), sp = b.querySelector('span');
    b.className = 'sync' + (S.fila.length ? ' salvando' : S.erroRede ? ' erro' : '');
    sp.textContent = S.fila.length ? (S.erroRede ? 'Sem conexão · ' + S.fila.length + ' a enviar' : 'Salvando…') : S.erroRede ? 'Sem conexão' : 'Salvo';
  }
  function atualizarDoServidor(forcar) {
    if (S.token && S.fila.length && !S.enviando) { enviarFila(); return Promise.resolve(); }
    if (!S.token || S.fila.length || document.hidden) return Promise.resolve();
    return api({ acao: 'versao', token: S.token }).then(function (r) {
      if (sessaoCaiu(r)) return sair('Sua sessão expirou. Digite o PIN de novo.');
      S.erroRede = false; marcaSync();
      if (!forcar && r.versao === S.versao) return;
      return api({ acao: 'estado', token: S.token }).then(function (e) {
        if (e.erro || S.fila.length || e.versao < S.versao) return;
        var mudou = e.versao !== S.versao;
        S.servidor = e.estado; S.versao = e.versao; S.historico = e.historico || S.historico;
        seguro(function () { recompor(); render(); });
        if (mudou && !forcar) toast('Atualizado com o que o outro mudou');
      });
    }).catch(function () { S.erroRede = true; marcaSync(); });
  }

  // ---------- calculo (uma vez por versao) ----------
  function calc() {
    if (S.calc) return S.calc;
    var e = S.estado, mHoje = cicloDe(hoje()), ini = e.inicio || mHoje;
    var fim = M.somaMeses(mHoje > ini ? mHoje : ini, 4), meses = M.meses(ini, fim);
    var D = e.divisao, ultimoFora = 0;
    if (D && D.porFora) Object.keys(D.porFora).sort().forEach(function (k) { ultimoFora = D.porFora[k]; });
    var porForaFuturo = S.simular ? ultimoFora : 0;
    S.calc = {
      meses: meses, mHoje: mHoje, ultimoFora: ultimoFora,
      ciclos: M.ciclos(meses, { dia: cicloDia() }),
      movs: M.gerarMovimentos(e, M.somaMeses(meses[0], -1), fim),
      div: null, erroDiv: null
    };
    if (D) { try { S.calc.div = Div.calcular(e, meses, { porForaFuturo: porForaFuturo }); } catch (x) { S.calc.erroDiv = x.message; console.error(x); } }
    return S.calc;
  }
  function dadosMes(m) {
    var C = calc(), i = C.meses.indexOf(m), p = C.ciclos[i];
    var movs = C.movs.filter(function (x) { return x.data >= p.de && x.data <= p.ate && x.perna !== 'entra'; });
    var serie = M.saldoDiario(C.movs, { de: p.de, ate: p.ate, periodos: [p] });
    return { i: i, p: p, movs: movs, serie: serie, div: C.div && C.div[i], pior: M.piorDia(serie) };
  }
  function status(mv) {
    if (mv.origem === 'faltando') return ['falt', 'sem valor'];
    if (mv.confirmado && mv.regra) return ['pago', mv.cents > 0 ? 'recebido' : 'pago'];
    if (mv.regra && mv.data < hoje()) return ['pend', 'confirmar'];
    if (mv.origem === 'estimado') return ['est', 'estimado'];
    return null;
  }

  // ---------- render ----------
  function render() {
    if (!S.estado) return;
    var C = calc();
    if (!S.mes || C.meses.indexOf(S.mes) < 0) S.mes = C.mHoje;
    $('months').innerHTML = C.meses.map(function (m) {
      return '<button type="button" data-mes="' + m + '" aria-pressed="' + (m === S.mes) + '" class="' + (m === C.mHoje ? 'atual' : '') + '">' + curtoMes(m) + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-aba') === S.aba ? 'true' : 'false'); });
    var html = S.aba === 'mes' ? telaMes() : S.aba === 'atualizar' ? telaAtualizar() : S.aba === 'divisao' ? telaDivisao() : telaHistorico();
    $('tela').innerHTML = html;
  }
  function centralizaMes() {
    var b = document.querySelector('#months button[aria-pressed="true"]');
    if (b && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function chip(st) { return st ? '<span class="chip ' + st[0] + '">' + st[1] + '</span>' : ''; }
  function tile(k, v, d, cls) { return '<div class="tile"><span class="k">' + k + '</span><span class="v num ' + (cls || '') + '">' + v + '</span>' + (d ? '<span class="d">' + d + '</span>' : '') + '</div>'; }

  function eventosPix(d, X) {
    // a Ma repassa ao Heleno o que a fila dela pagou: um Pix no dia do salario e o resto (ate a ajuda do pai) no dia dela
    var D = S.estado.divisao; if (!D || !X) return [];
    var total = Math.round((X.ma.boleto + X.ma.cartao + X.ma.outras + X.ma.divida) * 100) / 100;
    if (!total) return [];
    var sal = null, pai = null;
    d.movs.forEach(function (x) { if (x.regra === D.receitasMa[0]) sal = x; if (x.regra === D.receitasMa[1]) pai = x; });
    var p2 = pai ? Math.min(total, pai.valor) : 0, p1 = Math.round((total - p2) * 100) / 100, ev = [];
    if (p1 > 0 && sal) ev.push({ data: sal.data, nome: 'Pix da Ma para o Heleno', valor: p1 });
    if (p2 > 0 && pai) ev.push({ data: pai.data, nome: 'Pix da Ma para o Heleno', valor: p2 });
    return ev;
  }

  function telaMes() {
    var m = S.mes, d = dadosMes(m), X = d.div, out = [];
    if (calc().erroDiv) out.push('<div class="alerta"><p><b>A divisão deste período não fechou.</b> O fluxo abaixo está certo; avise o Heleno.</p></div>');
    var falt = d.movs.filter(function (x) { return x.origem === 'faltando'; });
    var pend = d.movs.filter(function (x) { return x.regra && !x.confirmado && x.data < hoje(); });
    if (falt.length || pend.length) {
      out.push('<div class="alerta">' + (falt.length ? '<p><b>Falta valor:</b> ' + falt.map(function (x) { return esc(x.nome); }).join(', ') + '. A previsão está incompleta.</p>' : '') +
        (pend.length ? '<p><b>' + pend.length + ' ' + (pend.length > 1 ? 'itens passaram' : 'item passou') + ' da data sem confirmar.</b> Toque neles no cronograma para marcar como pago ou recebido.</p>' : '') + '</div>');
    }
    out.push('<div class="tiles">' +
      tile('Sobra do casal', brl0(X ? X.casal : d.serie[d.serie.length - 1].fim), nomeMes(m)) +
      (X ? tile('Fica com o Heleno', brl0(X.heleno.fica), 'depois de tudo', X.heleno.fica < 0 ? 'neg' : '') + tile('Fica com a Ma', brl0(X.ma.fica), 'depois de tudo', X.ma.fica < 0 ? 'neg' : '') : '') +
      tile('Pior dia', brl0(d.pior.saldo), 'em ' + ddmm(d.pior.data), d.pior.saldo < 0 ? 'neg' : '') + '</div>');
    if (X && (X.devendo > 0 || X.atraso > 0)) {
      out.push('<p class="small">Acumulado até ' + nomeMes(m).toLowerCase() + ': ' +
        (X.devendo > 0 ? 'a Ma deve <b class="num">' + brl(X.devendo) + '</b> do cartão' : '') + (X.devendo > 0 && X.atraso > 0 ? ' · ' : '') +
        (X.atraso > 0 ? 'dívida atrasada <b class="num">' + brl(X.atraso) + '</b>' : '') + '. Detalhe na aba Divisão.</p>');
    }
    out.push('<section class="sec"><div class="sec-h"><h2>Saldo dia a dia</h2><span class="small">' + ddmm(d.p.de) + ' a ' + ddmm(d.p.ate) + '</span></div>' + grafico(d) + '</section>');
    // cronograma
    var porDia = {}, pix = eventosPix(d, X);
    d.movs.forEach(function (x) { (porDia[x.data] = porDia[x.data] || []).push(x); });
    pix.forEach(function (x) { (porDia[x.data] = porDia[x.data] || []).push({ pix: true, data: x.data, nome: x.nome, valor: x.valor }); });
    var saldo = {}; d.serie.forEach(function (s) { saldo[s.data] = s.fim; });
    var dias = Object.keys(porDia).sort(), h = hoje();
    out.push('<section class="sec"><div class="sec-h"><h2>Cronograma do mês</h2><span class="small">toque para atualizar</span></div><div class="dias">' +
      dias.map(function (dt) {
        return '<div class="dia' + (dt === h ? ' hoje' : '') + '" id="dia-' + dt + '"><div class="dia-h"><span class="data">' + ddmm(dt) + '<small>' + semana(dt) + (dt === h ? ' · hoje' : '') + '</small></span>' +
          '<span class="saldo num ' + (saldo[dt] < 0 ? 'neg' : '') + '">' + brl(saldo[dt]) + '</span></div>' +
          porDia[dt].map(function (x) {
            if (x.pix) return '<div class="item info"><span class="nm"><i class="quem" style="background:var(--ma)"></i><span>' + esc(x.nome) + '</span></span><span class="vl num">' + brl(x.valor) + '</span><span class="st"><span class="chip">não muda o saldo do casal</span></span></div>';
            var st = status(x), dono = donoDe(x);
            return '<button type="button" class="item" data-mov="' + esc(x.id) + '"><span class="nm"><i class="quem" style="background:' + COR[dono] + '"></i><span>' + esc(x.nome) + '</span></span>' +
              '<span class="vl num ' + (x.cents > 0 ? 'pos' : '') + '">' + (x.origem === 'faltando' ? '?' : (x.cents > 0 ? '+ ' : '− ') + brl(Math.abs(x.valor))) + '</span>' +
              (st ? '<span class="st">' + chip(st) + '</span>' : '') + '</button>';
          }).join('') + '</div>';
      }).join('') + '</div><p class="small">Saldo do casal no fim de cada dia, contando do zero no começo do mês (o dia do salário). <span style="color:var(--heleno)">●</span> Heleno <span style="color:var(--ma)">●</span> Ma <span style="color:var(--casa)">●</span> casa</p></section>');
    return out.join('');
  }

  function grafico(d) {
    var s = d.serie, W = 360, H = 150, T = 10, B = 22, n = s.length;
    var max = 0, min = 0; s.forEach(function (x) { if (x.fim > max) max = x.fim; if (x.fim < min) min = x.fim; });
    if (max === min) max = 1;
    var Y = function (v) { return T + (max - v) / (max - min) * (H - T - B); }, bw = W / n, z = Y(0), h = hoje();
    var barras = s.map(function (x, i) {
      var y = Math.min(Y(x.fim), z), hh = Math.max(1.5, Math.abs(Y(x.fim) - z));
      return '<rect x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5" fill="' +
        (x.fim < 0 ? 'var(--out)' : x.data === h ? 'var(--text)' : 'var(--heleno)') + '" data-dia="' + x.data + '"><title>' + ddmm(x.data) + ': ' + brl(x.fim) + '</title></rect>';
    }).join('');
    var marcas = [0, Math.floor(n / 2), n - 1].map(function (i) { return '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + ddmm(s[i].data) + '</text>'; }).join('');
    return '<div class="card chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Saldo do casal em cada dia do mês">' +
      '<line x1="0" x2="' + W + '" y1="' + z.toFixed(1) + '" y2="' + z.toFixed(1) + '" stroke="var(--line)"/>' + barras + marcas +
      '<text x="2" y="' + (Y(max) + 9).toFixed(1) + '" font-size="10" fill="var(--faint)">' + brl0(max) + '</text></svg>' +
      '<div class="lg"><span>Pior dia: <b class="num ' + (d.pior.saldo < 0 ? 'neg' : '') + '">' + brl(d.pior.saldo) + '</b> em ' + ddmm(d.pior.data) + '</span><span>Toque numa barra para ver o dia</span></div></div>';
  }

  function telaAtualizar() {
    var m = S.mes, d = dadosMes(m), out = [], D = S.estado.divisao;
    var regs = d.movs.filter(function (x) { return x.regra; });
    function linha(x, acoes, extra) {
      var dono = donoDe(x), st = status(x);
      return '<div class="linha"><div class="linha-h"><span class="t"><i class="quem" style="background:' + COR[dono] + '"></i>' + esc(x.nome) + '</span>' +
        '<span class="v num">' + (x.origem === 'faltando' ? '—' : brl(Math.abs(x.valor))) + '</span></div>' +
        '<div class="sub"><span>' + (x.cents > 0 ? 'entra' : 'vence') + ' ' + ddmm(x.data) + ' (' + semana(x.data) + ')</span>' + chip(st) + (extra || '') + '</div>' +
        '<div class="acoes">' + acoes + '</div></div>';
    }
    function botaoConf(x) {
      return x.confirmado ? '<button class="btn" data-acao="desconfirmar" data-mov="' + esc(x.id) + '">Desmarcar</button>'
        : '<button class="btn ok" data-acao="confirmar" data-mov="' + esc(x.id) + '">' + (x.cents > 0 ? 'Recebido' : 'Marcar paga') + '</button>';
    }
    var fat = regs.filter(function (x) { return x.grupo === 'fatura'; });
    var contas = regs.filter(function (x) { return x.grupo !== 'fatura' && x.cents <= 0; });
    var ent = regs.filter(function (x) { return x.cents > 0; });
    out.push('<section class="sec"><h2>Faturas de ' + nomeMes(m).toLowerCase() + '</h2><div class="lista">' + fat.map(function (x) {
      var extra = '';
      if (D && D.cartaoMa === x.regra && d.div) extra = '<span>parte da Ma ' + brl(d.div.ma.cartaoCheio) + (d.div.ma.cartaoEstimado ? ' (estimada)' : '') + '</span>';
      return linha(x, '<button class="btn pri" data-acao="fatura" data-mov="' + esc(x.id) + '">Atualizar total</button>' + botaoConf(x), extra);
    }).join('') + '</div></section>');
    out.push('<section class="sec"><h2>Contas</h2><div class="lista">' + contas.map(function (x) {
      return linha(x, '<button class="btn" data-acao="valor" data-mov="' + esc(x.id) + '">Mudar valor</button>' + botaoConf(x));
    }).join('') + '</div></section>');
    out.push('<section class="sec"><h2>Entradas</h2><div class="lista">' + ent.map(function (x) {
      return linha(x, botaoConf(x) + '<button class="btn" data-acao="valor" data-mov="' + esc(x.id) + '">Mudar valor</button>');
    }).join('') + '</div></section>');
    if (D) {
      var pf = D.porFora && m in D.porFora ? D.porFora[m] : null;
      out.push('<section class="sec"><h2>Gastos da Ma fora do cartão</h2><div class="linha"><div class="linha-h"><span class="t"><i class="quem" style="background:var(--ma)"></i>Pix, dinheiro, boletos dela</span><span class="v num">' + (pf == null ? '—' : brl(pf)) + '</span></div>' +
        '<p class="sub">Sai antes da fila dela (boleto → cartão → contas → dívida). ' + (pf == null ? 'Não informado: conta como zero.' : '') + '</p>' +
        '<div class="acoes"><button class="btn" data-acao="porfora">' + (pf == null ? 'Informar' : 'Mudar') + '</button></div></div></section>');
    }
    var av = d.movs.filter(function (x) { return x.origem === 'avulso'; });
    out.push('<section class="sec"><div class="sec-h"><h2>Gastos avulsos</h2></div><div class="lista">' + av.map(function (x) {
      return '<div class="linha"><div class="linha-h"><span class="t"><i class="quem" style="background:' + COR[donoDe(x)] + '"></i>' + esc(x.nome) + '</span><span class="v num ' + (x.cents > 0 ? 'pos' : '') + '">' + brl(Math.abs(x.valor)) + '</span></div>' +
        '<div class="sub"><span>' + ddmm(x.data) + ' · ' + NOME[x.caixa] + '</span></div><div class="acoes"><button class="btn del" data-acao="apagar" data-mov="' + esc(x.id) + '">Apagar</button></div></div>';
    }).join('') + '<button class="btn pri cheio" data-acao="avulso">+ Adicionar gasto fora do cartão</button></div></section>');
    out.push('<section class="sec"><button class="btn cheio" data-acao="novaconta">+ Nova conta todo mês</button><p class="small">Ex.: academia, seguro, assinatura. Aparece em todos os meses a partir de ' + nomeMes(m).toLowerCase() + '.</p></section>');
    return out.join('');
  }

  function telaDivisao() {
    var m = S.mes, d = dadosMes(m), X = d.div, C = calc();
    if (!X) return '<p>Sem regra de divisão.</p>';
    var out = [], futuroSemInfo = C.meses.some(function (k) { return !(k in (S.estado.divisao.porFora || {})); });
    out.push('<section class="sec"><p class="small">A Ma paga ' + brl(X.parte.ma) + ' da casa neste mês. A renda dela segue esta ordem: gastos por fora → boleto do apê → cartão dela → água, luz e internet → dívida.</p>');
    if (futuroSemInfo && C.ultimoFora > 0) {
      out.push('<div class="seg" role="group" aria-label="Simulação"><button type="button" data-sim="0" aria-pressed="' + !S.simular + '">Ma repassa tudo</button>' +
        '<button type="button" data-sim="1" aria-pressed="' + S.simular + '">Gasta ' + brl0(C.ultimoFora) + ' por fora</button></div>' +
        '<p class="small">Só muda os meses em que o gasto por fora dela ainda não foi informado.</p>');
    }
    out.push('</section>');
    var avisos = [];
    if (X.heleno.empresta > 0) avisos.push('<p>Faltaram <b>' + brl(X.heleno.empresta) + '</b> para o cartão da Ma: o Heleno paga e ela passa a dever.</p>');
    if (X.falta > 0) avisos.push('<p>Faltaram <b>' + brl(X.falta) + '</b> da parte dela nas contas: o Heleno cobre (não vira dívida).</p>');
    if (X.ma.divida < X.parcela) avisos.push('<p>A dívida recebeu <b>' + brl(X.ma.divida) + '</b> de ' + brl(X.parcela) + '. O resto atrasa.</p>');
    if (avisos.length) out.push('<div class="alerta">' + avisos.join('') + '</div>');
    function row(k, v, cls) { return '<div class="' + (cls || '') + '"><dt>' + k + '</dt><dd class="num">' + v + '</dd></div>'; }
    var fat = Object.keys(X.heleno.faturas).map(function (id) { var r = regra(id); return row(' · ' + esc(r ? r.nome : id) + (id === S.estado.divisao.cartaoMa ? ' (parte dele)' : ''), '− ' + brl(X.heleno.faturas[id])); }).join('');
    out.push('<div class="pessoas">' +
      '<div class="card"><h3 style="color:var(--ma)">Ma</h3><div><div class="big num ' + (X.ma.fica > 0 ? 'pos' : '') + '">' + brl(X.ma.fica) + '</div><span class="small">fica livre</span></div><dl class="rows">' +
      row('Recebe (salário + pai)', '+ ' + brl(X.ma.entra)) +
      (X.ma.porFora ? row('Gastos por fora' + (X.ma.porForaInformado ? '' : ' (simulado)'), '− ' + brl(X.ma.porFora)) : '') +
      row('1. Boleto do apê', '− ' + brl(X.ma.boleto)) +
      row('2. Cartão dela' + (X.ma.cartaoEstimado ? ' (estimado)' : ''), '− ' + brl(X.ma.cartao) + (X.ma.cartao < X.ma.cartaoCheio ? ' de ' + brl(X.ma.cartaoCheio) : ''), X.ma.cartao < X.ma.cartaoCheio ? 'warn' : '') +
      row('3. Água, luz e internet', '− ' + brl(X.ma.outras)) +
      row('4. Dívida', '− ' + brl(X.ma.divida), X.ma.divida < X.parcela ? 'warn' : '') +
      row('Fica livre', brl(X.ma.fica), 'tot') + '</dl></div>' +
      '<div class="card"><h3 style="color:var(--heleno)">Heleno</h3><div><div class="big num ' + (X.heleno.fica >= 0 ? 'pos' : 'neg') + '">' + brl(X.heleno.fica) + '</div><span class="small">fica livre</span></div><dl class="rows">' +
      row('Recebe (salários)', '+ ' + brl(X.heleno.entra)) +
      (X.heleno.divida ? row('Dívida que a Ma pagou', '+ ' + brl(X.heleno.divida)) : '') +
      row('Cartões dele', '− ' + brl(X.heleno.cartoes)) + fat +
      (X.heleno.outrosGastos ? row('Outros gastos', '− ' + brl(X.heleno.outrosGastos)) : '') +
      row('Parte dele da casa', '− ' + brl(X.heleno.casaParte)) +
      (X.heleno.cobre ? row('Cobre a Ma nas contas', '− ' + brl(X.heleno.cobre), 'warn') : '') +
      (X.heleno.empresta ? row('Paga o cartão da Ma (ela deve)', '− ' + brl(X.heleno.empresta), 'warn') : '') +
      row('Fica livre', brl(X.heleno.fica), 'tot') + '</dl></div></div>');
    var pix = eventosPix(d, X);
    out.push('<section class="sec"><h2>Pix da Ma para o Heleno</h2><div class="dias">' + (pix.length ? pix.map(function (x) {
      return '<div class="dia"><div class="dia-h"><span class="data">' + ddmm(x.data) + '<small>' + semana(x.data) + '</small></span><span class="saldo num">' + brl(x.valor) + '</span></div></div>';
    }).join('') : '<div class="dia">Nada a repassar neste mês.</div>') + '</div><p class="small">Ele paga as contas e o cartão da conta dele; ela repassa a parte dela nesses dias.</p></section>');
    out.push('<section class="sec"><h2>Acumulado até ' + nomeMes(m).toLowerCase() + '</h2><div class="tiles">' +
      tile('Ma deve do cartão', brl0(X.devendo), 'o Heleno pagou por ela', X.devendo > 0 ? 'neg' : '') +
      tile('Dívida atrasada', brl0(X.atraso), 'parcela de ' + brl0(X.parcela) + '/mês', X.atraso > 0 ? 'neg' : '') + '</div></section>');
    return out.join('');
  }

  function telaHistorico() {
    if (!S.historico.length) return '<p class="small">Nada mudou ainda. Tudo o que vocês dois atualizarem aparece aqui.</p>';
    return '<section class="sec"><h2>O que mudou</h2><div class="hist">' + S.historico.map(function (h) {
      var dt = h.quando || ''; return '<div><span><b>' + esc(h.quem) + '</b> ' + esc(h.texto) + '</span><small>' + dt.slice(8, 10) + '/' + dt.slice(5, 7) + ' às ' + dt.slice(11, 16) + '</small></div>';
    }).join('') + '</div></section>';
  }

  // ---------- janela de edicao ----------
  function janela(cfg) {
    var slot = $('veu-slot');
    slot.innerHTML = '<div class="veu" id="veu"><form class="sheet" id="sheet" novalidate><h3>' + esc(cfg.titulo) + '</h3>' + (cfg.texto ? '<p class="small">' + esc(cfg.texto) + '</p>' : '') +
      cfg.campos.map(function (c) {
        if (c.tipo === 'opcoes') return '<div class="campo"><label>' + esc(c.label) + '</label><div class="opcoes" data-campo="' + c.id + '">' +
          c.opcoes.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (o[0] === c.valor) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>';
        var attrs = c.tipo === 'dinheiro' ? 'type="text" inputmode="decimal" class="dinheiro" autocomplete="off" placeholder="0,00"'
          : c.tipo === 'data' ? 'type="date"' : c.tipo === 'numero' ? 'type="text" inputmode="numeric" autocomplete="off"' : 'type="text" autocomplete="off" maxlength="60"';
        return '<div class="campo"><label for="f-' + c.id + '">' + esc(c.label) + '</label><input id="f-' + c.id + '" ' + attrs + ' value="' + esc(c.valor == null ? '' : c.valor) + '">' + (c.ajuda ? '<span class="ajuda">' + esc(c.ajuda) + '</span>' : '') + '</div>';
      }).join('') +
      '<p class="erro" id="sheet-erro" role="alert"></p><div class="botoes"><button type="button" class="btn" id="sheet-cancelar">Cancelar</button><button type="submit" class="btn pri">' + esc(cfg.ok || 'Salvar') + '</button></div>' +
      (cfg.extra ? cfg.extra : '') + '</form></div>';
    var veu = $('veu'), confirmouBaixo = false;
    function fechar() { slot.innerHTML = ''; }
    veu.addEventListener('click', function (ev) { if (ev.target === veu) fechar(); });
    $('sheet-cancelar').addEventListener('click', fechar);
    Array.prototype.forEach.call(veu.querySelectorAll('.opcoes button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(b.parentNode.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
    });
    if (cfg.aoMontar) cfg.aoMontar(veu, fechar);
    $('sheet').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = {};
      cfg.campos.forEach(function (c) {
        if (c.tipo === 'opcoes') { var b = veu.querySelector('[data-campo="' + c.id + '"] [aria-pressed="true"]'); v[c.id] = b ? b.getAttribute('data-v') : null; }
        else { var raw = $('f-' + c.id).value; v[c.id] = c.tipo === 'dinheiro' ? lerValor(raw) : raw.trim(); }
      });
      var erro = cfg.validar ? cfg.validar(v) : null;
      if (erro) { $('sheet-erro').textContent = erro; return; }
      if (cfg.anterior && v.valor != null && v.valor < cfg.anterior * 0.1 && !confirmouBaixo) {
        confirmouBaixo = true;
        $('sheet-erro').textContent = 'Confere? ' + brl(v.valor) + ' é bem menor que ' + brl(cfg.anterior) + '. Toque em Salvar de novo para confirmar.';
        return;
      }
      fechar(); cfg.salvar(v);
    });
    var primeiro = veu.querySelector('input');
    if (primeiro && !cfg.semFoco) setTimeout(function () { primeiro.focus(); if (primeiro.select) primeiro.select(); }, 60);
  }
  function precisaValor(v, nome) { return v == null || isNaN(v) ? 'Digite ' + (nome || 'o valor') + ' (ex.: 1.234,56)' : null; }

  function movPorId(id) { var C = calc(); for (var i = 0; i < C.movs.length; i++) if (C.movs[i].id === id) return C.movs[i]; return null; }
  function abrirFatura(mv) {
    var r = regra(mv.regra), D = S.estado.divisao, ehMa = D && D.cartaoMa === mv.regra, vm = M.valorDoMes(r, mv.mes);
    var esperado = vm.origem === 'informado' ? vm.valor : null, X = calc().div && calc().div[calc().meses.indexOf(mv.mes)];
    var campos = [{ id: 'valor', label: 'Total da fatura de ' + nomeMes(mv.mes).toLowerCase(), tipo: 'dinheiro', valor: paraCampo(vm.valor), ajuda: 'O novo total substitui o anterior (não soma).' }];
    if (ehMa) campos.push({ id: 'parteMa', label: 'Parte da Ma ("Família e amigos" no app do banco)', tipo: 'dinheiro', valor: paraCampo(X ? X.ma.cartaoCheio : 0) });
    janela({ titulo: r.nome, campos: campos, anterior: vm.valor,
      validar: function (v) { return precisaValor(v.valor) || (ehMa && precisaValor(v.parteMa, 'a parte da Ma')) || (ehMa && v.parteMa > v.valor ? 'A parte da Ma não pode passar do total.' : null); },
      salvar: function (v) { var op = { tipo: 'fatura', regra: mv.regra, mes: mv.mes, valor: v.valor, esperado: esperado }; if (ehMa) op.parteMa = v.parteMa; operar(op); } });
  }
  function abrirValor(mv) {
    var r = regra(mv.regra), atual = M.valorDoMes(r, mv.mes).valor;
    janela({ titulo: r.nome, anterior: atual, campos: [
      { id: 'valor', label: 'Novo valor', tipo: 'dinheiro', valor: paraCampo(atual) },
      { id: 'quando', label: 'Vale para', tipo: 'opcoes', valor: 'so', opcoes: [['so', 'Só ' + nomeMes(mv.mes).toLowerCase()], ['frente', 'Daqui pra frente']] }],
      validar: function (v) { return precisaValor(v.valor); },
      salvar: function (v) { operar({ tipo: 'valor', regra: mv.regra, mes: mv.mes, valor: v.valor, esperado: atual, daquiPraFrente: v.quando === 'frente' }); } });
  }
  function confirmarMov(mv) {
    var r = regra(mv.regra), atual = M.valorDoMes(r, mv.mes).valor;
    if (atual == null) {
      return janela({ titulo: r.nome, texto: 'Essa conta ainda não tem valor. Quanto foi?', campos: [{ id: 'valor', label: 'Valor', tipo: 'dinheiro', valor: '' }],
        validar: function (v) { return precisaValor(v.valor); },
        salvar: function (v) { operar({ tipo: 'confirmar', regra: mv.regra, mes: mv.mes, valor: v.valor }); } });
    }
    operar({ tipo: 'confirmar', regra: mv.regra, mes: mv.mes, valor: atual }, function () {
      toast((mv.cents > 0 ? 'Recebido: ' : 'Pago: ') + r.nome, false, function () { operar({ tipo: 'desconfirmar', regra: mv.regra, mes: mv.mes }); });
    });
  }
  function abrirMov(mv) {
    if (mv.origem === 'avulso') return janela({ titulo: mv.nome, texto: brl(Math.abs(mv.valor)) + ' em ' + ddmm(mv.data) + ' · ' + NOME[mv.caixa], campos: [], ok: 'Apagar',
      salvar: function () { operar({ tipo: 'removerAvulso', id: mv.id }); } });
    var r = regra(mv.regra), st = status(mv), ehFat = mv.grupo === 'fatura';
    janela({ titulo: r.nome, texto: (mv.origem === 'faltando' ? 'Sem valor' : brl(Math.abs(mv.valor))) + ' · ' + (mv.cents > 0 ? 'entra' : 'vence') + ' ' + ddmm(mv.data) + (st ? ' · ' + st[1] : ''), campos: [], ok: 'Fechar',
      salvar: function () {},
      extra: '<div class="acoes" style="display:grid;gap:8px">' +
        (ehFat ? '<button type="button" class="btn pri cheio" data-j="fatura">Atualizar total da fatura</button>' : '<button type="button" class="btn cheio" data-j="valor">Mudar valor</button>') +
        (mv.confirmado ? '<button type="button" class="btn cheio" data-j="desconfirmar">Desmarcar ' + (mv.cents > 0 ? 'recebido' : 'pago') + '</button>'
          : '<button type="button" class="btn ok cheio" data-j="confirmar">' + (mv.cents > 0 ? 'Marcar como recebido' : 'Marcar como pago') + '</button>') + '</div>',
      semFoco: true,
      aoMontar: function (veu, fechar) {
        Array.prototype.forEach.call(veu.querySelectorAll('[data-j]'), function (b) {
          b.addEventListener('click', function () { var j = b.getAttribute('data-j'); fechar(); acao(j, mv); });
        });
      } });
  }
  function acao(j, mv) {
    if (j === 'fatura') abrirFatura(mv);
    else if (j === 'valor') abrirValor(mv);
    else if (j === 'confirmar') confirmarMov(mv);
    else if (j === 'desconfirmar') operar({ tipo: 'desconfirmar', regra: mv.regra, mes: mv.mes });
    else if (j === 'apagar') janela({ titulo: 'Apagar ' + mv.nome + '?', texto: brl(Math.abs(mv.valor)) + ' em ' + ddmm(mv.data), campos: [], ok: 'Apagar', salvar: function () { operar({ tipo: 'removerAvulso', id: mv.id }); } });
  }
  function novoAvulso() {
    var p = dadosMes(S.mes).p, h = hoje(), dt = h >= p.de && h <= p.ate ? h : p.de;
    janela({ titulo: 'Gasto fora do cartão', campos: [
      { id: 'nome', label: 'O que foi', tipo: 'texto', valor: '' },
      { id: 'valor', label: 'Valor', tipo: 'dinheiro', valor: '' },
      { id: 'data', label: 'Data', tipo: 'data', valor: dt },
      { id: 'caixa', label: 'Quem pagou', tipo: 'opcoes', valor: S.pessoa, opcoes: [['heleno', 'Heleno'], ['ma', 'Ma']] },
      { id: 'tipo', label: 'Tipo', tipo: 'opcoes', valor: 'gasto', opcoes: [['gasto', 'Gasto'], ['entrada', 'Entrada de dinheiro']] }],
      validar: function (v) { return !v.nome ? 'Escreva o que foi.' : precisaValor(v.valor) || (!/^\d{4}-\d{2}-\d{2}$/.test(v.data) ? 'Escolha a data.' : null); },
      salvar: function (v) { operar({ tipo: 'avulso', nome: v.nome, valor: v.valor, data: v.data, caixa: v.caixa, entrada: v.tipo === 'entrada' }); } });
  }
  function novaConta() {
    janela({ titulo: 'Nova conta todo mês', campos: [
      { id: 'nome', label: 'Nome', tipo: 'texto', valor: '' },
      { id: 'valor', label: 'Valor por mês', tipo: 'dinheiro', valor: '' },
      { id: 'dia', label: 'Dia do vencimento', tipo: 'numero', valor: '10' },
      { id: 'dono', label: 'De quem', tipo: 'opcoes', valor: S.pessoa, opcoes: [['heleno', 'Heleno'], ['ma', 'Ma'], ['casa', 'Casa']] },
      { id: 'tipo', label: 'É', tipo: 'opcoes', valor: 'conta', opcoes: [['conta', 'Conta'], ['fatura', 'Fatura de cartão'], ['entrada', 'Entrada']] }],
      validar: function (v) { var d = +v.dia; return !v.nome ? 'Dê um nome.' : precisaValor(v.valor) || (!(d >= 1 && d <= 31) ? 'Dia entre 1 e 31.' : null); },
      salvar: function (v) { operar({ tipo: 'novaConta', nome: v.nome, valor: v.valor, dia: +v.dia, dono: v.dono, inicio: S.mes, fatura: v.tipo === 'fatura', natureza: v.tipo === 'entrada' ? 'entrada' : 'saida', diaUtil: v.tipo === 'fatura' }); } });
  }
  function abrirPorFora() {
    var D = S.estado.divisao, m = S.mes, atual = D.porFora && m in D.porFora ? D.porFora[m] : null;
    janela({ titulo: 'Gastos da Ma fora do cartão', texto: nomeMes(m) + ': quanto da renda dela foi para Pix, dinheiro e boletos dela (fora a fatura).',
      campos: [{ id: 'valor', label: 'Valor', tipo: 'dinheiro', valor: paraCampo(atual) }],
      validar: function (v) { return precisaValor(v.valor); },
      salvar: function (v) { operar({ tipo: 'porFora', mes: m, valor: v.valor, esperado: atual }); } });
  }

  // ---------- aviso rapido ----------
  var toastTm;
  function toast(msg, ruim, desfazer) {
    clearTimeout(toastTm);
    $('toast-slot').innerHTML = '<div class="toast' + (ruim ? ' ruim' : '') + '" role="status"><span>' + esc(msg) + '</span>' + (desfazer ? '<button type="button" id="desfazer">Desfazer</button>' : '') + '</div>';
    if (desfazer) $('desfazer').addEventListener('click', function () { $('toast-slot').innerHTML = ''; desfazer(); });
    toastTm = setTimeout(function () { $('toast-slot').innerHTML = ''; }, ruim ? 6000 : desfazer ? 5000 : 1800);
  }

  // ---------- entrada (PIN toda vez) ----------
  var L = { pessoa: null, modo: null, pin: '', primeiro: null, pins: null };
  function telaLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    if (!L.pessoa) {
      $('login').innerHTML = '<div class="login-box"><h1>Casal</h1><p class="small">Quem está usando?</p><div class="quem-btns">' +
        '<button type="button" data-p="heleno"><i style="background:var(--heleno)"></i>Heleno</button><button type="button" data-p="ma"><i style="background:var(--ma)"></i>Ma</button></div>' +
        '<p class="erro" role="alert">' + esc(msg || '') + '</p></div>';
      return;
    }
    var titulo = L.modo === 'criar' ? (L.primeiro ? 'Repita o PIN' : 'Crie seu PIN de 4 números') : 'PIN de ' + NOME[L.pessoa];
    $('login').innerHTML = '<div class="login-box"><h1 style="color:' + COR[L.pessoa] + '">' + NOME[L.pessoa] + '</h1><p>' + titulo + '</p>' +
      '<div class="pin-dots" aria-label="' + L.pin.length + ' de 4 números">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < L.pin.length ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      '<p class="erro" role="alert" id="login-erro">' + esc(msg || '') + '</p>' +
      '<div class="teclado">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(function (k) {
        return k === '' ? '<span></span>' : '<button type="button" data-k="' + k + '" aria-label="' + (k === '⌫' ? 'Apagar' : k) + '">' + k + '</button>';
      }).join('') + '</div><button type="button" class="voltar" data-trocar="1">Não é ' + NOME[L.pessoa] + '? Trocar</button></div>';
  }
  function tecla(k) {
    if (L.ocupado) return;
    if (k === '⌫') L.pin = L.pin.slice(0, -1); else if (L.pin.length < 4) L.pin += k;
    telaLogin();
    if (L.pin.length === 4) enviarPin(); // na hora: digito rapido nao pode se perder entre um PIN e outro
  }
  function enviarPin() {
    var pin = L.pin;
    if (L.modo === 'criar' && !L.primeiro) { L.primeiro = pin; L.pin = ''; return telaLogin(); }
    if (L.modo === 'criar' && L.primeiro !== pin) { L.primeiro = null; L.pin = ''; return telaLogin('Os dois PINs não batem. Crie de novo.'); }
    L.ocupado = true; $('login-erro').textContent = 'Entrando…';
    api({ acao: L.modo === 'criar' ? 'criarPin' : 'entrar', pessoa: L.pessoa, pin: pin }).then(function (r) {
      L.ocupado = false; L.pin = '';
      if (r.erro) {
        L.primeiro = null;
        if (/Crie seu PIN/.test(r.erro)) L.modo = 'criar';
        if (/já foi criado/.test(r.erro)) { L.modo = 'entrar'; if (L.pins) L.pins[L.pessoa] = true; }
        return telaLogin(r.erro);
      }
      iniciar(r);
    }).catch(function () { L.ocupado = false; L.pin = ''; telaLogin('Sem internet. Tente de novo.'); });
  }
  function escolher(p) {
    L.pessoa = p; L.pin = ''; L.primeiro = null;
    try { localStorage.setItem('casal-pessoa', p); } catch (x) {}
    var definir = function () { L.modo = L.pins && L.pins[p] === false ? 'criar' : 'entrar'; telaLogin(); };
    if (L.pins) definir(); else api({ acao: 'status' }).then(function (r) { L.pins = r.pins; definir(); }).catch(function () { L.modo = 'entrar'; telaLogin('Sem internet.'); });
  }
  function iniciar(r) {
    S.token = r.token; S.pessoa = r.pessoa; S.servidor = r.estado; S.versao = r.versao; S.historico = r.historico || [];
    S.fila = lerFila(r.pessoa).map(function (f) { return { op: f.op }; }); S.erroRede = false;
    seguro(recompor);
    $('login').hidden = true; $('app').hidden = false; $('login').innerHTML = '';
    $('titulo').textContent = NOME[S.pessoa]; $('eu-cor').style.background = COR[S.pessoa];
    S.mes = null; seguro(render); centralizaMes(); marcaSync();
    if (S.fila.length) { toast('Enviando ' + S.fila.length + ' mudança(s) que tinham ficado guardadas…'); enviarFila(); }
  }
  function sair(msg) {
    guardarFila(); clearTimeout(tentaDeNovo);
    S.token = null; S.estado = null; S.servidor = null; S.fila = []; S.enviando = false; L.pin = ''; L.primeiro = null; L.modo = 'entrar';
    telaLogin(msg);
  }

  // ---------- eventos (delegados: um ouvinte para a tela toda) ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, rect[data-dia]');
    if (!t) return;
    if (t.hasAttribute('data-p')) return escolher(t.getAttribute('data-p'));
    if (t.hasAttribute('data-k')) return tecla(t.getAttribute('data-k'));
    if (t.hasAttribute('data-trocar')) { L.pessoa = null; return telaLogin(); }
    if (t.hasAttribute('data-mes')) { S.mes = t.getAttribute('data-mes'); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-aba')) { S.aba = t.getAttribute('data-aba'); render(); window.scrollTo(0, 0); if (S.aba === 'historico') atualizarDoServidor(true); return; }
    if (t.hasAttribute('data-sim')) { S.simular = t.getAttribute('data-sim') === '1'; S.calc = null; render(); return; }
    if (t.id === 'sync') { atualizarDoServidor(true); return; }
    if (t.hasAttribute('data-dia')) { var el = $('dia-' + t.getAttribute('data-dia')); if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } return; }
    var a = t.getAttribute('data-acao'), mv = t.hasAttribute('data-mov') ? movPorId(t.getAttribute('data-mov')) : null;
    if (t.classList.contains('item') && mv) return abrirMov(mv);
    if (a === 'avulso') return novoAvulso();
    if (a === 'novaconta') return novaConta();
    if (a === 'porfora') return abrirPorFora();
    if (a && mv) return acao(a, mv);
  });
  document.addEventListener('keydown', function (ev) {
    if (!$('login').hidden && L.pessoa && /^[0-9]$/.test(ev.key)) tecla(ev.key);
    else if (!$('login').hidden && L.pessoa && ev.key === 'Backspace') tecla('⌫');
    else if (ev.key === 'Escape' && $('veu')) $('veu-slot').innerHTML = '';
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) atualizarDoServidor(); });
  window.addEventListener('online', function () { espera = 3000; if (S.fila.length) enviarFila(); else atualizarDoServidor(); });
  setInterval(function () { atualizarDoServidor(); }, 20000);

  // ---------- comeco ----------
  try { var ult = localStorage.getItem('casal-pessoa'); if (ult === 'heleno' || ult === 'ma') L.pessoa = ult; } catch (x) {}
  api({ acao: 'status' }).then(function (r) { L.pins = r.pins; if (L.pessoa) { L.modo = r.pins[L.pessoa] ? 'entrar' : 'criar'; telaLogin(); } }).catch(function () {});
  L.modo = 'entrar'; telaLogin();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__casal = S; // para os testes automaticos
})();
