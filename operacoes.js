// Operacoes de edicao do app do casal. O MESMO codigo roda no celular (aplica na hora, sem esperar o servidor)
// e no servidor (aplica de verdade, com trava). Cada operacao devolve um texto curto para o historico e o Telegram.
// Conflito: quando a operacao traz 'esperado' e o valor atual mudou (o outro mexeu antes), recusa em vez de sobrescrever.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./motor.js'));
  else root.Operacoes = factory(root.Motor);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  var NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function mesCurto(m) { return NOMES_MES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4); }
  function brl(v) {
    var s = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '-' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
  }
  function Conflito(msg) { var e = new Error(msg); e.conflito = true; return e; }
  function Invalido(msg) { var e = new Error(msg); e.invalido = true; return e; }
  function regra(estado, id) {
    for (var i = 0; i < estado.regras.length; i++) if (estado.regras[i].id === id) return estado.regras[i];
    throw Invalido('Conta nao encontrada: ' + id);
  }
  function num(v, nome) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e7) throw Invalido('Valor invalido em ' + nome);
    return Math.round(v * 100) / 100;
  }
  function mes(v) { if (!/^\d{4}-\d{2}$/.test(v || '')) throw Invalido('Mes invalido'); return v; }
  function data(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw Invalido('Data invalida'); return v; }
  function confere(atual, esperado, oque) {
    if (esperado === undefined) return;
    var a = atual == null ? null : Math.round(atual * 100), b = esperado == null ? null : Math.round(esperado * 100);
    if (a !== b) throw Conflito(oque + ' mudou enquanto você editava (agora está ' + (atual == null ? 'vazio' : brl(atual)) + '). Confira e tente de novo.');
  }
  // id que vem do celular: formato fixo e sem repetir (nao pode colidir com conta existente nem com outro lancamento)
  function idNovo(e, id, prefixo) {
    if (id == null) return novoId(prefixo);
    if (!new RegExp('^' + prefixo + '-[a-z0-9]{4,24}$').test(id)) throw Invalido('Identificador invalido');
    var usados = (e.regras || []).map(function (r) { return r.id; }).concat((e.avulsos || []).map(function (a) { return a.id; }));
    if (usados.indexOf(id) >= 0) throw Invalido('Identificador repetido');
    return id;
  }
  function novoId(prefixo) { return prefixo + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

  var OPS = {
    // Total da fatura do mes (substitui, nunca soma). No cartao dividido, junto vai a parte da Ma.
    fatura: function (e, o) {
      var rg = regra(e, o.regra), m = mes(o.mes), v = num(o.valor, 'valor');
      var antes = M.valorDoMes(rg, m);
      confere(antes.origem === 'informado' ? antes.valor : null, o.esperado, 'A fatura');
      M.alterarSoEsteMes(rg, m, v);
      var txt = 'atualizou a ' + rg.nome + ' de ' + mesCurto(m) + ': ' + (antes.valor == null ? '' : brl(antes.valor) + ' → ') + brl(v);
      if (o.parteMa != null && e.divisao && e.divisao.cartaoMa === rg.id) {
        var pm = num(o.parteMa, 'parte da Ma');
        if (pm > v) throw Invalido('A parte da Ma não pode ser maior que a fatura');
        e.divisao.parteMa[m] = pm; txt += ' (parte da Ma ' + brl(pm) + ')';
      }
      return txt;
    },
    // Valor de uma conta: so neste mes, ou deste mes em diante
    valor: function (e, o) {
      var rg = regra(e, o.regra), m = mes(o.mes), v = num(o.valor, 'valor'), antes = M.valorDoMes(rg, m).valor;
      confere(antes, o.esperado, rg.nome);
      if (o.daquiPraFrente) M.alterarDaquiPraFrente(rg, m, v); else M.alterarSoEsteMes(rg, m, v);
      return 'mudou ' + rg.nome + ' ' + (o.daquiPraFrente ? 'de ' + mesCurto(m) + ' em diante' : 'só em ' + mesCurto(m)) + ': ' + (antes == null ? '' : brl(antes) + ' → ') + brl(v);
    },
    // Pago / recebido de fato (substitui o previsto, nunca desconta duas vezes)
    confirmar: function (e, o) {
      var rg = regra(e, o.regra), m = mes(o.mes), id = rg.id + '|' + m;
      e.confirmacoes = e.confirmacoes || {};
      if (e.confirmacoes[id] && o.esperado === undefined) throw Conflito(rg.nome + ' de ' + mesCurto(m) + ' já foi confirmada pelo outro.');
      var cf = { por: o.autor || null };
      if (o.valor != null) cf.valor = num(o.valor, 'valor');
      if (o.data) cf.data = data(o.data);
      e.confirmacoes[id] = cf;
      var v = cf.valor != null ? cf.valor : M.valorDoMes(rg, m).valor;
      return (rg.tipo === 'entrada' ? 'marcou como recebido: ' : 'marcou como pago: ') + rg.nome + ' de ' + mesCurto(m) + (v != null ? ' (' + brl(v) + ')' : '');
    },
    desconfirmar: function (e, o) {
      var rg = regra(e, o.regra), m = mes(o.mes);
      if (!e.confirmacoes || !e.confirmacoes[rg.id + '|' + m]) throw Conflito('Isso já estava desmarcado.');
      delete e.confirmacoes[rg.id + '|' + m];
      return 'desmarcou ' + rg.nome + ' de ' + mesCurto(m);
    },
    // Gasto ou entrada fora do cartao (Pix, dinheiro, boleto avulso). valor > 0 = gasto.
    avulso: function (e, o) {
      var nome = String(o.nome || '').trim().slice(0, 60);
      if (!nome) throw Invalido('Escreva o que foi');
      var v = num(o.valor, 'valor'), d = data(o.data), entrada = !!o.entrada;
      var caixa = o.caixa === 'ma' ? 'ma' : 'heleno';
      e.avulsos = e.avulsos || [];
      e.avulsos.push({ id: idNovo(e, o.id, 'av'), nome: nome, caixa: caixa, valor: entrada ? v : -v, data: d, casa: !!o.casa, por: o.autor || null });
      return (entrada ? 'lançou uma entrada: ' : 'lançou um gasto: ') + nome + ' ' + brl(v) + ' em ' + d.slice(8, 10) + '/' + d.slice(5, 7);
    },
    removerAvulso: function (e, o) {
      var lista = e.avulsos || [], i = lista.map(function (a) { return a.id; }).indexOf(o.id);
      if (i < 0) throw Conflito('Esse lançamento já foi apagado.');
      var a = lista.splice(i, 1)[0];
      return 'apagou o lançamento ' + a.nome + ' ' + brl(Math.abs(a.valor));
    },
    // Quanto da renda da Ma foi para gastos fora do cartao no mes (entra no comeco da fila dela)
    porFora: function (e, o) {
      var m = mes(o.mes), v = num(o.valor, 'valor'), D = e.divisao;
      var antes = D.porFora && m in D.porFora ? D.porFora[m] : null;
      confere(antes, o.esperado, 'O gasto por fora');
      D.porFora = D.porFora || {}; D.porFora[m] = v;
      return 'informou os gastos da Ma fora do cartão em ' + mesCurto(m) + ': ' + brl(v);
    },
    // Conta nova recorrente (todo mes)
    novaConta: function (e, o) {
      var nome = String(o.nome || '').trim().slice(0, 50);
      if (!nome) throw Invalido('Dê um nome para a conta');
      var dia = Math.round(o.dia);
      if (!(dia >= 1 && dia <= 31)) throw Invalido('Dia de vencimento entre 1 e 31');
      var m = mes(o.inicio), v = num(o.valor, 'valor'), tipo = o.natureza === 'entrada' ? 'entrada' : 'saida';
      var dono = ['heleno', 'ma', 'casa'].indexOf(o.dono) >= 0 ? o.dono : 'heleno';
      if (o.fatura && tipo === 'entrada') throw Invalido('Fatura de cartão não pode ser entrada');
      var rg = { id: idNovo(e, o.id, 'ct'), nome: nome, caixa: dono === 'ma' ? 'ma' : 'heleno', dono: dono, tipo: tipo,
        grupo: o.fatura ? 'fatura' : 'fixa', casa: dono === 'casa', estimado: !!o.estimado || !!o.fatura,
        data: o.diaUtil ? { dia: dia, ajuste: 'proximo' } : { dia: dia }, inicio: m, vigencias: [{ desde: m, valor: v }], porMes: {} };
      e.regras.push(rg);
      return 'criou a conta ' + nome + ' (' + brl(v) + ', dia ' + dia + ')';
    },
    // Encerrar uma recorrencia: o ultimo mes que vale. O historico fica.
    encerrar: function (e, o) {
      var rg = regra(e, o.regra), m = mes(o.ultimoMes);
      if (e.divisao && (e.divisao.cartaoMa === rg.id || e.divisao.boleto === rg.id || e.divisao.receitasMa.indexOf(rg.id) >= 0))
        throw Invalido(rg.nome + ' faz parte da regra de divisão e não pode ser encerrada aqui');
      M.encerrar(rg, m);
      return 'encerrou ' + rg.nome + ' a partir de ' + mesCurto(M.somaMeses(m, 1));
    }
  };

  // Aplica a operacao NO PROPRIO objeto estado (quem chama passa uma copia se quiser preservar o original).
  function aplicar(estado, op) {
    var f = op && typeof op.tipo === 'string' && Object.prototype.hasOwnProperty.call(OPS, op.tipo) ? OPS[op.tipo] : null;
    if (!f) throw Invalido('Operacao desconhecida');
    return f(estado, op);
  }
  return { aplicar: aplicar, tipos: Object.keys(OPS), brl: brl, mesCurto: mesCurto };
});
