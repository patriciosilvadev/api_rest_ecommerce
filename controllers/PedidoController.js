const mongoose = require("mongoose")

const Pedido = mongoose.model("Pedido");
const Usuario = mongoose.model("Usuario");
const Produto = mongoose.model("Produto");
const Variacao = mongoose.model("Variacao");
const Pagamento = mongoose.model("Pagamento");
const Entrega = mongoose.model("Entrega");
const Cliente = mongoose.model("Cliente");
const RegistroPedido = mongoose.model("RegistroPedido")

const { calcularFrete } = require("./integracoes/correios")
const  EntregaValidation  = require ("./validacoes/entregaValidation")
const  PagamentoValidation  = require ("./validacoes/pagamentoValidation")
const QuantidadeValidation = require("./validacoes/quantidadeValidation")

const EmailController = require("./EmailCotroller")

const  CarrinhoValidation  = require ("./validacoes/carrinhoValidation")

class PedidoController {    
    //ADMIN
    async indexAdmin (req, res, next){
        const { offset, limit, loja } = req.query;const  EntregaValidation  = require ("./validacoes/entregaValidation")
        try {
            const pedidos = await Pedido.paginate(
                { loja },
                { 
                    offset: Number(offset || 0), 
                    limit: Number(limit || 30), 
                    populate: ["cliente", "pagamento","entrega"] 
                }
                
            );
            
            pedidos.docs = await Promise.all(pedidos.docs.map(async (pedido) => {
                pedido.carrinho = await Promise.all(pedido.carrinho.map(async (item) => {
                    item.produto = await Produto.findById(item.produto);
                    item.variacao = await Variacao.findById(item.variacao);
                    return item;
                }));
                return pedido;
            }));
            return res.send({ pedidos });
        } catch(e){
            next(e);
        }
    }
    
    async showAdmin(req,res,next){
        try {
            const pedido = await Pedido
                                    .findOne({ loja: req.query.loja, _id: req.params.id })
                                    .populate(["cliente", "pagamento", "entrega"]);
            pedido.carrinho = await Promise.all(pedido.carrinho.map(async (item) =>{
                item.produto = await Produto.findById(item.produto);
                item.variacao = await Variacao.findById(item.variacao);
                return item;
            }));
            const registros = await RegistroPedido.find({ pedido: pedido._id})
            return res.send({ pedido, registros  });

        } catch (e) {
            next(e)
        }
    }

    async removeAdmin (req,res,next){
        try {
            const pedido = await Pedido.findOne({ 
                                                loja: req.query.loja, 
                                                _id: req.params.id
                                            })
                                                .populate({ path: "cliente", populate: {path:"usuario"} })
            if(!pedido) res.status(400).send({ error: "Pedido não encontrado"});
            pedido.cancelado = true;

            const registroPedido = new RegistroPedido({
                pedido: pedido._id,
                tipo: "pedido",
                situacao: "pedido_cancelado"
            });
            await registroPedido.save();
            //ENVIAR EMAIL PARA CLIENTE e ADMIN  = pedido cancelado;
            EmailController.cancelarPedido({ usuario: pedido.cliente.usuario, pedido });

            await pedido.save();

            await QuantidadeValidation.atualizarQuantidade("cancelar_pedido", pedido)

            return res.send({ cancelado: true })
        } catch (e) {
            console.log(e)
            next(e)
        }
    }

    async showCarrinhoPedidoAdmin(req,res,next){
        try {
            const pedido = await Pedido.findOne({ loja: req.query.loja, _id: req.params.id });
            pedido.carrinho = await Promise.all(pedido.carrinho.map(async (item) =>{
                item.produto = await Produto.findById(item.produto);
                item.variacao = await Variacao.findById(item.variacao);
                return item;
            }));
            return res.send({ carrinho: pedido.carrinho });

        } catch (e) {
            next(e)
        }
    };

    // CLIENTE 
    async index(req,res,next){
        const { offset, limit, loja } = req.query;
        try {
            const cliente = await Cliente.findOne({ usuario: req.payload.id });
            const pedidos = await Pedido.paginate(
                { loja, cliente: cliente._id }, 
                { 
                offset: Number(offset || 0), 
                limit: Number(limit || 30 ), 
                populate:["cliente", "pagamento", "entrega"] 
            });
            pedidos.docs = await Promise.all(pedidos.docs.map(async(pedido) =>{
                pedido.carrinho = await Promise.all(pedido.carrinho.map(async (item) =>{
                    item.produto = await Produto.findById(item.produto);
                    item.variacao = await Variacao.findById(item.variacao);
                    return item;
                }))
                return pedido;
            }))
            return res.send({ pedidos })
        } catch (e) {
            next(e)
        }
    };
    async show(req,res,next){
        try {
            const cliente = await Cliente.findOne({ usuario: req.payload.id });
            const pedido = await Pedido
                                    .findOne({ cliente: cliente._id, _id: req.params.id })
                                    .populate(["cliente", "pagamento", "entrega"]);
            pedido.carrinho = await Promise.all(pedido.carrinho.map(async (item) =>{
                item.produto = await Produto.findById(item.produto);
                item.variacao = await Variacao.findById(item.variacao);
                return item;
            }));
            const registros = await RegistroPedido.find({ pedido: pedido._id})

            const resultado = await calcularFrete({ cep: "65052735", produtos: pedido.carrinho })


            return res.send({ pedido , registros });

        } catch (e) {
            next(e)
        }
    };
    async store (req,res,next){
        const {  carrinho, pagamento, entrega } = req.body;
        const { loja } = req.query;
        const _carrinho = carrinho.slice();
        try {
            
            //CHECAR DADOS DO CARRINHO

            if(!await CarrinhoValidation(carrinho)) return res.status(422).send({ error: "Carrinho inválido"})
            const cliente = await Cliente.findOne({usuario: req.payload.id}).populate({path:"usuario", "select":"_id noome email"})

            if(!await QuantidadeValidation.validarQuantidadeDisponivel(carrinho)) return res.status(400).send({ error: "Produtos não tem quantidade disponivel" });
             //CHECAR DADOS DA ENTREGA
             if(!await EntregaValidation.checarValorPrazo(cliente.endereco.CEP, carrinho, entrega)) return res.status(422).send({ error: "Dados de Entrega Inválidos" });
           
             //CHECAR DADOS DO PAGAMENTO
           if(! await PagamentoValidation.checarValorTotal({carrinho, pagamento, entrega} )) return res.status(422).send({ error: "Dados de pagamento inválidos"})
           if(!PagamentoValidation.checarCartao(pagamento)) return res.status(422).send({ error: "Dados de pagamento com cartao inválidos"})

           

            const novoPagamento = new Pagamento({
                valor: pagamento.valor,
                parcelas: pagamento.parcelas || 1,
                forma: pagamento.forma,
                status: "Iniciando",
                endereco: pagamento.endereco,
                cartao: pagamento.cartao,
                enderecoEntregaIgualCobranca: pagamento.enderecoEntregaIgualCobranca,
                loja
            });

            const novaEntrega = new Entrega({
                status: "nao_Iniciado",
                custo: entrega.custo,
                prazo: entrega.prazo,
                tipo: entrega.tipo,
                endereco: entrega.endereco,
                loja
            });

            const pedido = new Pedido({
                cliente: cliente._id,
                carrinho: _carrinho,
                pagamento: novoPagamento._id,
                entrega: novaEntrega._id,
                loja
            });
            novoPagamento.pedido = pedido._id;
            novaEntrega.pedido = pedido._id;

            await pedido.save();
            await novoPagamento.save();
            await novaEntrega.save();

            await QuantidadeValidation.atualizarQuantidade("salvar_pedido", pedido)

            const registroPedido = new RegistroPedido({
                pedido: pedido._id,
                tipo: "pedido",
                situacao: "pedido_criado"
            });
            await registroPedido.save();

            //notificar via email cliente e admin novo pedido
            EmailController.enviarNovoPedido({ pedido, usuario: cliente.usuario });
            const administradores = await Usuario.find({ permissao: "admin", loja})
            administradores.forEach((usuario)=>{
                EmailController.enviarNovoPedido({ pedido, usuario: usuario });
            })

            return res.send({ pedido: Object.assign({}, pedido._doc, { entrega: novaEntrega, pagamento: novoPagamento, cliente }) })        
        } catch (e) {
            next(e)
        }
    };
    async remove(req,res,next){
        try {
            const cliente = await Cliente.findOne({ usuario: req.payload.id });
            if(!cliente) res.status(400).send({ error: "Cliente não encontrado"});
            const pedido = await Pedido.findOne({ cliente: cliente._id, _id: req.params.id})
            if(!pedido) res.status(400).send({ error: "Pedido não encontrado"});
            pedido.cancelado = true;
            
            const registroPedido = new RegistroPedido({
                pedido: pedido._id,
                tipo: "pedido",
                situacao: "pedido_cancelado"
            });
            await registroPedido.save();
            //ENVIAR EMAIL PARA CLIENTE e ADMIN  = pedido cancelado;
            const administradores = await Usuario.find({ permissao: "admin", loja:pedido.loja})
            administradores.forEach((usuario)=>{
                EmailController.cancelarPedido({ pedido, usuario: usuario });
            })

            await pedido.save();

            await QuantidadeValidation.atualizarQuantidade("cancelar_pedido", pedido)
            return res.send({ cancelado: true })
        } catch (e) {
            next(e)
        }
    };

    async showCarrinhoPedido(req,res,next){
        try {
            const cliente = await Cliente.findOne({ usuario: req.payload.id });
            const pedido = await Pedido.findOne({ cliente: cliente._id, _id: req.params.id });
            pedido.carrinho = await Promise.all(pedido.carrinho.map(async (item) =>{
                item.produto = await Produto.findById(item.produto);
                item.variacao = await Variacao.findById(item.variacao);
                return item;
            }));
            return res.send({ carrinho: pedido.carrinho });

        } catch (e) {
            next(e)
        }
    }; 


}
module.exports = PedidoController;