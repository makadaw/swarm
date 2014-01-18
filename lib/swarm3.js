var Swarm = {};

//  S P E C I F I E R
//
//  The Swarm aims to switch fully from the classic HTTP
//  request-response client-server interaction pattern to continuous
//  real-time synchronization (WebSocket), possibly involving
//  client-to-client interaction (WebRTC) and client-side storage
//  (WebStorage). That demands (a) unification of transfer and storage
//  where possible and (b) transferring, processing and storing of
//  fine-grained changes.
//
//  That's why we use compound event identifiers named *specifiers*
//  instead of just regular "plain" object ids everyone is so used to.
//  Our ids have to fully describe the context of every small change as
//  it is likely to be delivered, processed and stored separately from
//  the rest of the related state.  For every atomic operation, be it a
//  field mutation or a method invocation, a specifier contains its
//  class, object id, a method name and, most importantly, its
//  version id.
//
//  A serialized specifier is a sequence of Base64 tokens each prefixed
//  with a "quant". A quant for a class name is '/', an object id is
//  prefixed with '#', a method with '.' and a version id with '!'.  A
//  special quant '+' separates parts of each token.  For example, a
//  typical version id looks like "!7AMTc+gritzko" which corresponds to
//  a version created on Tue Oct 22 2013 08:05:59 GMT by @gritzko (see
//  Host.version()).
//
//  A full serialized specifier looks like
//        /TodoItem#7AM0f+gritzko.done!7AMTc+gritzko
//  (a todo item created by @gritzko was marked 'done' by himself)
//
//  Specifiers are stored in strings, but we use a lightweight wrapper
//  class Spec to parse them easily. A wrapper is immutable as we pass
//  specifiers around a lot.
function Spec (str,quant) {
    if (str===undefined)
        console.log('new Spec',str,quant);
    if (str && str.constructor===Spec) {
        str=str.value;
    } else { // later we assume value has valid format
        str = (str||'').toString();
        if (quant && str.charAt(0)>='0')
            str = quant + str;
        if (str.replace(Spec.reQTokExt,''))
            throw new Error('malformed specifier: '+str);
    }
    this.value = str;
    this.index = 0;
}
Spec.prototype.filter = function (quants) {
    return new Spec(
        this.value.replace(Spec.reQTokExt,function (token,quant) {
            return quants.indexOf(quant)!==-1 ? token : ''; 
        })
    );
};
Spec.prototype.pattern = function () {
    return this.value.replace(Spec.reQTokExt,'$1');
};
Spec.prototype.token = function (quant) {
    var at = quant ? this.value.indexOf(quant,this.index) : this.index;
    if (at===-1) return undefined;
    Spec.reQTokExt.lastIndex = at;
    var m=Spec.reQTokExt.exec(this.value);
    this.index = Spec.reQTokExt.lastIndex;
    if (!m) return undefined;
    var ret = { quant:m[1], body:m[2], bare:m[3], ext:m[4] };
    return ret;
};
Spec.prototype.get = function (quant) {
    var i = this.value.indexOf(quant);
    if (i===-1) return '';
    Spec.reQTokExt.lastIndex = i;
    var m=Spec.reQTokExt.exec(this.value);
    return m&&m[2];
};
Spec.prototype.has = function (quant) {
    return this.value.indexOf(quant)!==-1;
};
Spec.prototype.version = function () { return this.get('!') };
Spec.prototype.method = function () { return this.get('.') };
Spec.prototype.type = function () { return this.get('/') };
Spec.prototype.id = function () { return this.get('#') };

Spec.prototype.sort = function () {
    function Q (a, b) {
        var qa = a.charAt(0), qb = b.charAt(0), q = Spec.quants;
        return (q.indexOf(qa) - q.indexOf(qb)) || (a<b);
    };
    var split = this.value.match(Spec.reQTokExt);
    return new Spec(split?split.sort(Q).join(''):'');
};
/** mutates */
Spec.prototype.add = function (spec,quant) {
    if (spec.constructor!==Spec)
        spec = new Spec(spec,quant);
    return new Spec(this.value+spec.value);
};
Spec.prototype.toString = function () { return this.value };


Spec.int2base = function (i,padlen) {
    var ret = '', togo=padlen||5;
    for (; i||(togo>0); i>>=6, togo--)
        ret = Spec.base64.charAt(i&63) + ret;
    return ret;
};

Spec.base2int = function (base) {
    var ret = 0, l = base.match(Spec.re64l);
    for (var shift=0; l.length; shift+=6)
        ret += Spec.base64.indexOf(l.pop()) << shift;
    return ret;
};

Spec.base64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~';
Spec.rT = '[0-9A-Za-z_~]+';
Spec.re64l = new RegExp('[0-9A-Za-z_~]','g');
Spec.quants = ['/','#','!','.'];
Spec.reTokExt = new RegExp('^(=)(?:\\+(=))?$'.replace(/=/g,Spec.rT));
Spec.reQTokExt = new RegExp('([/#\\.!\\*])((=)(?:\\+(=))?)'.replace(/=/g,Spec.rT),'g');
Spec.is = function (str) {
    return str && (str.constructor===Spec || ''===str.toString().replace(Spec.reQTokExt,''));
};

Spec.Map = function VersionVectorAsAMap (vec) {
    this.map = {};
    vec && this.add(vec);
};
Spec.Map.prototype.add = function (versionVector) {
    var vec=new Spec(versionVector,'!'), tok;
    while (tok=vec.token('!')) {
        var time = tok.bare, source = tok.ext||'swarm';
        if (time > (this.map[source]||''))
            this.map[source] = time;
    }
};
Spec.Map.prototype.covers = function (version) {
    Spec.reQTokExt.lastIndex = 0;
    var m = Spec.reTokExt.exec(version);
    var ts = m[1], src = m[2] || 'swarm';
    return ts <= (this.map[src]||'');
};
Spec.Map.prototype.toString = function (trim) {
    trim = trim || {top:10,rot:'0'};
    var top = trim.top || 10, rot = '!' + (trim.rot||'0');
    var ret = [], map = this.map;
    for(var src in map)
        ret.push('!'+map[src]+'+'+src);
    ret.sort().reverse();
    while (ret.length>top || ret[ret.length-1]<=rot)
        ret.pop();
    return ret.join('')||'!0';
};

/** Syncable: an oplog-synchronized object */
var Syncable = Swarm.Syncable = function Syncable () {
    // listeners
    this._lstn = [];
    // _version is not a fully specified version vector (see vector());
    // it is the greatest operation timestamp (Lamport-like, i.e. "time+source"),
    // sometimes amended with additional timestamps. Its main features:
    // (1) changes once the object's state changes
    // (2) does it monotonically (in the alphanum order sense)
    this._version = '';
    // make sense of arguments
    var args=arguments, al=args.length, state={};
    this._host = (al && args[al-1].constructor===Host) ?
        args[al-1] : Swarm.localhost;
    var version = this._host.version();
    if (al && args[0].constructor===String && Spec.reTokExt.test(args[0])) {
        this._id = args[0];
        state = undefined; // may pull the state for the id
    } else if (al && Spec.is(args[0])) {
        this._id = new Spec(args[0]).id();
        state = undefined; // TODO ignores values: bad
    } else {
        args[0]!==this._host && (state=args[0]);
        this._id = version;
    }
    // register with the host
    var doubl = this._host.register(this);
    if (doubl!==this) return doubl;
    // initialize metadata _fields
    var spec = this.spec();
    spec.add(version,'!');
    spec.add('.init');
    // got state => may init
    state && this.init(spec,state,this._host);
    // connect to the sync tree
    this.checkUplink();
};

Syncable.types = {};

// wrap the operation's code with signature normalization
Syncable.sigwrap = function sigwrap (proto,acname,alias) {
    var m = acname.match(Syncable.re_acname);
    var receivable = (m[1]==='$'), emittable = (m[2]==='$'), name = m[3];
    var wrap = function sigwrapd() {
        this.normalizeSignature(arguments,name);
        var spec=arguments[0], value=arguments[1], replica=arguments[2];
        Swarm.debug && this.log(spec,value,replica);
        if (!this._id)
            throw new Error('undead object invoked');

        // TODO this.validate(), this.acl(), try{} catch()

        var returnedValue = this[acname](spec,value,replica);

        emittable && this.__emit(spec,value,replica);
        if (emittable && this._oplog) { // remember in the log
            //var verop = spec.filter('!.');
            //verop && (this._oplog[verop] = value);
            this._oplog[spec.filter('!.')] = value; // FIXME pojo
            this.compactLog && this.compactLog(); // TODO optimize
        }
        if (receivable||emittable) { // state changing
            var opver = spec.version();
            if (this._version!==opver) // ? TODO
                this._version = (opver>this._version) ? opver : this._version+'!'+opver;
        }
        // to force async signatures we eat the returned value silently
        return spec;
    }
    wrap._impl = acname;
    proto[name] = wrap;
}
Syncable.re_acname = /^([$_])([$_])(\w+)$/;
Syncable._default = {};


/**  All state-changing methods of a syncable class must be...
  *  $$operation
  *  $_no-emit-operation
  *  _$rpcCall  
  *  __sig3Method
  *  plainMethod()
  */
Syncable.extend = function(fn,own) {
    var parent = this;
    if (fn.constructor!==Function) {
        var id = fn.toString();
        fn = function SomeSyncable(){
            for(var name in fn.defaults) {
                var dv = fn.defaults[name];
                this[name] = dv.constructor===Object ? new dv.type(dv.value) : dv;
            }
            return parent.apply(this, arguments); 
        };
        fn.id = fn.name = id; // if only it worked
    } else // please call Syncable.constructor.apply(this,args) in the constructor
        fn.id = fn.name;
    // inheritance trick from backbone.js
    var Surrogate = function(){ this.constructor = fn; };
    Surrogate.prototype = parent.prototype;
    var fnproto = fn.prototype = new Surrogate;
    // default field values
    var defs = fn.defaults = own.defaults || {};
    for(var k in defs)
        if (defs[k].constructor===Function)
            defs[k] = {type:defs[k]};
    delete own.defaults;
    // add methods
    for (var prop in own) {// extend
        if (Syncable.re_acname.test(prop)) { // an op
            Syncable.sigwrap(fnproto,prop);
            own[prop].constructor===String && (own[prop]=own[own[prop]]); // aliases
        }
        fnproto[prop] = own[prop];
    }
    // finishing touches
    fnproto._super = parent.prototype;
    fn._super = parent;
    fnproto._type = fn.id;
    fnproto._reactions = {};
    fn._pt = fnproto; // just a shortcut
    fn.extend = this.extend;
    fn.addReaction = this.addReaction;
    fn.removeReaction = this.removeReaction;
    Syncable.types[fn.id] = fn;
    return fn;
};

// A *reaction* is a hybrid of a listener and a method. It "reacts" on a
// certain event for all objects of that type. The callback gets invoked
// as a method, i.e. this===syncableObj. In an event-oriented architecture
// reactions are rather handy, e.g. for creating mixins.
Syncable.addReaction = function (method,fn) {
    var reactions = this.prototype._reactions;
    var list = reactions[method];
    if (!list)
        list = reactions[method] = [];
    list.push(fn);
    return {method:method,fn:fn};
};

Syncable.removeReaction = function (handle) {
    var method=handle.method, fn=handle.fn;
    var list = this.prototype._reactions[method];
    var i = list.indexOf(fn);
    if (i===-1) throw new Error('reaction unknown');
    list[i] = undefined; // such a peculiar pattern not to mess up out-of-callback removal 
    while (list.length && !list[list.length-1]) list.pop();
};

// 3-parameter signature
//  * specifier (or a base64 string)
//  * value anything but a function
//  * source/callback - anything that can receive events
Syncable.prototype.normalizeSignature = function (args,method) {
    var len = args.length;
    while (len && args[len-1]===undefined) len--;
    if (len===0 || len>3)
        throw new Error('invalid number of arguments');
    var version = this._host.version(); // moment of *this* event FIXME on-demand
    // normalize replica/callback
    if (typeof(args[len-1])==='function') // model.on(callback)
        args[len-1] = {deliver:args[len-1],_wrapper:true};
    if (len<3 && args[len-1] && typeof(args[len-1].deliver)==='function') {
        args[2] = args[len-1]; // model.on(replica), model.on(key,replica)
        args[len-1] = null;
    }
    // normalize value
    if (!args[1] && !Spec.is(args[0]) ){//}&& typeof(args[0])==='object') {
        args[1] = args[0]; // model.set({key:value})
        args[0] = null;    // model.on('key')
    }
    // normalize specifier; every op needs to be fully specd
    var spec = new Spec(args[0]||'');
    // COMPLEX CASE: 1st arg may be a value which is a specifier
    if ( len<3 && ( (spec.type() && spec.type()!==this._type) ||
         (spec.id() && spec.id()!==this._id) ) ) {
             if (!args[1]) {
                args[1] = args[0];
                spec = args[0] = this.spec();
             } else
                throw new Error('not my event: '+spec);
         }
    spec.has('/') || (spec=spec.add(this._type,'/'));
    spec.has('#') || (spec=spec.add(this._id,'#'));
    spec.has('!') || (spec=spec.add(version,'!'));
    spec.has('.') || (spec=spec.add(method,'.'));
    spec=spec.sort();
    args[0] = spec;
};


// Syncable includes all the (replica) spanning tree and (distributed)
// garbage collection logix.
Syncable.extend(Syncable,{  // :P
    spec: function () { return new Spec('/'+this._type+'#'+this._id); }, 
    // dispatches serialized operations back to their respective methods
    deliver: function (spec,value,lstn) {
        var pattern = spec.pattern();
        if (pattern==='/#!.') {
            var method = spec.method();
            if (typeof(this[method])==='function' && this[method]._impl)
                this[method](spec,value,lstn);
            else
                this.default(spec,value,lstn);
        } else if (pattern==='/#') { // unbundle
            var specs = [];
            for (var sp in value)
                new Spec(sp).pattern()==='!.' && specs.push(sp);
            specs.sort().reverse();
            while (s=specs.pop())
                this.deliver(new Spec(spec.toString()+s),value[s],lstn); // TODO polish
        } else
            throw new Error('malformed spec: '+spec);
    },
    // notify all the listeners of an operation
    __emit: function (spec,value,source) {
        var ls = this._lstn;
        if (!ls || !ls.length) return;
        //this._lstn = []; // cycle protection
        for(var i=0; i<ls.length; i++)
            if (ls[i] && ls[i]!==source && ls[i].constructor!==Array)
                try {// skip empties, deferreds and the source
                    ls[i].deliver(spec,value,this);
                } catch (ex) {
                    console.error(ex.message,ex.stack);
                }
        var r = this._reactions[spec.method()];
        if (r) {
            r.constructor!==Array && (r = [r]);
            for(var i=0; i<r.length; i++)
                r[i] && r[i].call(this,spec,value,source);
        }
        //if (this._lstn.length)
        //    throw new Error('Speedy Gonzales at last');
        //this._lstn = ls; // cycle protection off
    },
    // Blindly applies a JSON changeset to this model.
    apply: function (values) {
        for(var key in values) {
            //if (Model.reFieldName.test(key) && typeof(this[key])!=='function'){ 
            // FIXME validate()
                var def = this.constructor.defaults[key];
                this[key] = def&&def.type ? new def.type(values[key]) : values[key];
        }
    },
    validateOrder: function (spec,val,src) {
        /*var source = Spec.ext(version);
        for(var opspec in this._oplog) 
            if (opspec.indexOf(source)!==-1) {
                var v=new Spec(opspec).version(), s=Spec.ext(v);
                if (s===source && version<=v)
                    return; // replay!
             }*/
    },
    // the version vector for this object
    version: function () {
        var map = new Spec.Map(this._version);
        if (this._oplog)
            for(var op in this._oplog)
                map.add(op);
        return map.toString();
    },
    
    // Produce the entire state or probably the necessary difference
    // to synchronize a replica which is at version *base*.
    diff: function (base) {
    },
    $_init: function () {
    },
    acl: function (spec,val,src) {
        return true;
    },
    validate: function (spec,val,src) {
        return true;
    },
    // Subscribe to the object's operations;
    // the upstream part of the two-way subscription
    //  on() with a full filter:
    //    /Mouse#Mickey!now.on   !since.event   callback
    __on: function (spec,filter,repl) {   // WELL  on() is not an op, right?
        // if no listener is supplied then the object is only
        // guaranteed to exist till the next Swarm.gc() run
        // stateless object fire no events; essentially, on() is deferred
        if (!repl) return;
        this._lstn.length || this._lstn.push(undefined);

        if (this._lstn[0]) {
            var filter = new Spec(filter,'.'), // TODO prettify
                base = filter.filter('!'),
                event = filter.get('.');
            if (event) {
                if (event==='init') {
                    repl.deliver(spec,this.pojo(),this);
                }
            }
            this._lstn.push( repl ); // TODO holes
            if (base && base.toString()) { // :(
                repl.deliver(this.spec(), this.diff(base), this);
                repl.reon (this.spec(), this.version(), this); // FIXME vector
            }
        } else {
            this._lstn.push( [spec,filter,repl] ); // defer this call (see __reon)
        }
        // TODO repeated subscriptions: send a diff, otherwise ignore
    },
    // downstream reciprocal subscription
    __reon: function (spec,base,repl) {
        if (!repl) throw new Error('?');
        var deferreds = [], dfrd, diff;
        if (!this._lstn[0]) {
            this._lstn[0] = repl;
            // do deferred diff responses and reciprocal subscriptions
            this._lstn = this._lstn.filter(function(ln,i){
                return !(ln.constructor===Array && deferreds.push(ln));
            });
            while (dfrd = deferreds.pop())
                this.__on.apply(this,dfrd);
        } else {
            console.warn('reon: violent uplink change: ',this._lstn[0],repl);
            this._lstn.unshift(repl);
            this._lstn[1].off(this.spec(),this);
        }
        if ( base && (diff=this.diff(base)) ) // TODO format
            repl.deliver(this.spec(),diff,this);
    },
    // Unsubscribe
    __off: function (spec,val,repl) {
        var ls = this._lstn;
        var i = ls.indexOf(repl); // fast path
        if (i===-1) 
            for(var i=0; i<ls.length; i++) {
                var l = ls[i];
                if (l && l._wrapper && l.deliver===repl.deliver)
                    break;
                if (l && l.constructor===Array && l[2]===repl)
                    break;
            }
        if (i===ls.length)
            throw new Error("listener unknown");
        ls[i] = undefined;    
        while (ls.length>1 && !ls[ls.length-1])
            ls.pop();
    },
    __reoff: function (spec,val,repl) {
        if (this._lstn[0]!==repl)
            throw new Error('reoff: uplink mismatch');
        this._lstn[0] = undefined; // may be shifted
        this._id && this.checkUplink();
    },
    // Subscribes an object to the closest uplink (closest in terms of consistent
    // hashing). Cancels any other preexisting subscriptions.
    checkUplink: function () {
        var spec = this.spec();
        var uplinks = this._host.availableUplinks(spec);
        var closest = uplinks.shift();
         
        if (this._lstn[0]===closest) return;
        closest.on(spec+this.version(),this);
            
        while (almost=uplinks.pop()) // B I N G O
            if (this._lstn.indexOf(almost)!==-1)
                almost.off(spec,this);;
    },
    // Sometimes we get an operation we don't support; not normally
    // happens for a regular replica, but still needs to be caught
    $_default: function (spec,val,repl) {
    },
    // As all the event/operation processing is asynchronous, we
    // cannot simply throw/catch exceptions over the network.
    // Hence, this method allows to send errors back asynchronously.
    $_err: function (spec,val,repl) {
        console.error('something failed: '+spec+' at '+repl._id);
    },
    // Deallocate everything, free all resources.
    close: function () {
        var l=this._lstn, s=this.spec();
        var uplink = l.shift();
        this._id = null; // no id - no object; prevent relinking
        uplink && uplink.off(s,null,this);
        while (l.length)
            l.pop().reoff(s,null,this);
        this._host.unregister(this);
    },
    // Once an object is not listened by anyone it is perfectly safe
    // to garbage collect it.
    gc: function () {
        var l = this._lstn;
        if (!l.length || (l.length===1 && !l[0]))
            this.close();
    },
    log: function(spec,value,replica) {
        var myspec = this.spec().toString(); //:(
        console.log(
            "%c%s %c%s %c%s %c%O %c%s %c@%s",
            "color: grey",
                this._host._id,
            "color: #204",
                this.spec().toString(),
            "color: #024; font-style: italic",
                (myspec==spec.filter('/#')?
                    spec.filter('!.').toString() :
                    spec.toString()),
            "font-style: normal; color: #000",
                (value&&value.constructor===Spec?value.toString():value),
            "color: #88a",
                (replica&&((replica.spec&&replica.spec().toString())||replica._id)) ||
                    (replica?'no id':'undef'),
            "color: #ccd",
                replica&&replica._host&&replica._host._id
                //replica&&replica.spec&&(replica.spec()+
                //    (this._host===replica._host?'':' @'+replica._host._id)
        );
    },
    __once: function (spec,something,cb) {
        var onceWrap = function () {
            cb.deliver.apply(this,arguments);
            this.off(spec,something,onceWrap);
        };
        this.on(spec,something,onceWrap);
    }
});


var Model = Swarm.Model = Syncable.extend('Model',{
    defaults: {
        _oplog: Object
    },
    /**  init modes:
    *    1  fresh id, fresh object
    *    2  known id, stateless object
    *    3  known id, state boot
    */
    $_init: function (spec,snapshot,host) {
        if (this._id===spec.version() && !snapshot._oplog) { // new fresh object  TODO nicer
            snapshot = snapshot || this._default || {};
            this.apply(snapshot);
        } else { // the state has arrived; apply it
            this.unpackState(snapshot);
            this._oplog = snapshot._oplog || {}; // TODO merge local edits & foreign oplog
            for (sp in this._oplog) {
                var v = new Spec(sp).version();
                if (v>this._version)
                    this._version=v;
            }
            this.apply(snapshot);
        }
        //Syncable._pt.$_init.apply(this,arguments);
    },
    
    __on: function (spec,base,repl) {
        //  support the model.on('field',callback_fn) pattern
        if (repl && repl._wrapper && base.constructor===String && base!=='init') {
            repl._deliver = repl.deliver;
            var self = this;
            repl.deliver = function (spec,val,src) {
                if (spec.method()==='set' && (base in val))
                    this._deliver.call(self,spec,val,src);
            }
        }
        // this will delay response if we have no state yet
        Syncable._pt.__on.call(this,spec,base,repl);
    },
    
    __off: function (spec,base,repl) {
        var ls = this._lstn;
        if (repl._wrapper && base.constructor===String)
            for(var i=0;i<ls.length;i++)
                if (ls[i]._deliver===repl.deliver) {
                    repl.deliver = ls[i].deliver; // FIXME ugly
                }
        Syncable.prototype.__off.apply(this,arguments);
    },
    
    
    diff: function (base) {
        var ret = null;
        if (base && base!='!0') { // diff sync
            var map = new Spec.Map(base); // FIXME ! and bare
            for(var spec in this._oplog)
                if (!map.covers(new Spec(spec).version())) {
                    ret || (ret = {});
                    ret[spec] = this._oplog[spec];
                }
            // TODO log truncation, forced init and everything
        } else { // snapshot sync
            if (this._version) {
                ret = {};
                var key = '!'+this._version+'.init';
                ret[key] = this.pojo();
                ret[key]._oplog = {};
                ret[key]._version = this._version;
                for(var spec in this._oplog)
                    ret[key]._oplog[spec] = this._oplog[spec];
                this.packState(ret);
            }
        }
        return ret;
    },
    
    // TODO remove unnecessary value duplication
    packState: function (state) {
    },
    unpackState: function (state) {
    },
    /** Removes redundant information from the log; as we carry a copy
     *  of the log in every replica we do everythin to obtain the minimal
     *  necessary subset of it.
     *  As a side effect, distillLog allows up to handle some partial
     *  order issues (see $$set). */
    distillLog: function () {
        // explain
        var sets = [], cumul = {}, heads = {};
        for(var spec in this._oplog)
            if (new Spec(spec).method==='set')
                sets.push(spec);
        sets.sort();
        for(var i=sets.length-1; i>=0; i--) {
            var spec = sets[i], val = this._oplog[spec], notempty=false;
            for(var key in val)
                if (key in cumul)
                    delete val[key];
                else
                    notempty = cumul[key] = true;
            var source = new Spec(key).source();
            notempty || (heads[source] && delete this._oplog[spec]);
            heads[source] = true;
        }
        return cumul;
    },
    /** This barebones Model class implements just one kind of an op:
     *  set({key:value}). To implment your own ops you need to understand
     *  implications of partial order as ops may be applied in slightly
     *  different orders at different replicas. This implementation
     *  may resort to distillLog() to linearize ops.
     * */
    $$set: function (spec,value,repl) {
        var version = spec.version(), vermet = spec.filter('!.').toString();
        if (vermet in this._oplog)
            return; // replay
        this._oplog[vermet] = value._id ? value._id : value; // TODO nicer (sigwrap)  FIXME POJO
        if (version<this._version) { //
            this.distillLog(); // may amend the value
        }
        var distilled = this._oplog[vermet];
        distilled && this.apply(distilled);
    },
    pojo: function () {
        var pojo = {}, defs = this.constructor.defaults;
        for(var key in this) 
            if (Model.reFieldName.test(key) && this.hasOwnProperty(key)) {
                var def = defs[key], val = this[key];
                pojo[key] = def&&def.type ? (val.toJSON&&val.toJSON()) || val.toString() : 
                            (val&&val._id ? val._id : val) ; // TODO prettify
            }
        return pojo;
    },
    fill: function (key) { // TODO goes to Model to support references
        if (!this.hasOwnProperty(key))
            throw new Error('no such entry');
        //if (!Spec.is(this[key]))
        //    throw new Error('not a specifier');
        var spec = new Spec(this[key]).filter('/#');
        if (spec.pattern()!=='/#')
            throw new Error('incomplete spec');
        this[key] = this._host.get(spec);
        /* TODO new this.refType(id) || new Swarm.types[type](id);
        on('init', function(){
            self.emit('fill',key,this)
            self.emit('full',key,this)
        });*/
    },
    save: function () {
        var cumul = this.compactLog(), changes = {}, pojo=this.pojo();
        for(var key in pojo)
            if (this[key]!==cumul[key]) // TODO nesteds
                changes[key] = this[key];
        for(var key in cumul)
            if (!(key in pojo))
                changes[key] = null; // JSON has no undefined
        this.set(changes);
    }
});
Model.reFieldName = /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/;

// Model may have reactions for field changes as well as for 'real' ops/events
// (a field change is a .set operation accepting a {field:newValue} map)
Model.addReaction = function (methodOrField, fn) {
    var proto = this.prototype;
    if (typeof(proto[methodOrField])==='function') { // it is a field name
        return Syncable.addReaction.call(this,methodOrField,fn);
    } else {
        var wrapper = function (spec,val) {
            if (methodOrField in val)
                fn.apply(this,arguments);
        };
        wrapper._rwrap = true;
        return Syncable.addReaction.call(this,'set',wrapper);
    }
};


// Backbone's Collection is essentially an array and arrays behave poorly
// under concurrent writes (see OT). Hence, our primary collection type
// is a {key:Model} Set. One may obtain a linearized version by sorting
// them by keys or otherwise.
var Set = Swarm.Set = Model.extend('Set', {
    // an alias for $$set()
    add: function (key,spec) {
        var obj; // TODO add(obj)
        if (spec._id) {
            obj = spec;
            spec = obj.spec();
        } 
        var kv = {};
        kv[key] = spec;
        var spec = this.set(kv);
        obj && (this[key]=obj); // sorta auto-fill
        //method := 'add'
        //this._emit();
    },
    remove: function (key) {
        var kv = {};
        kv[key] = undefined;
        this.set(kv);  // FIXME key:val instead of {key:val} pidorasit
        //method := 'remove'
        //this._emit();
    },
    get: function (key) {
        // TODO default type
        if (!this.hasOwnProperty(key)) // FIXME regex check
            return undefined;
        if (!this[key]._id)
            this.fill(key);
        return this[key];
    },
    fillAll: function () {
        var keys = this.pojo();
        for(var key in keys)
            if (this[key] && !this[key]._id)
                this.fill(key); // TODO events init->???
    },
    collection: function () {
        var keys = [], obj = [], pojo=this.pojo();
        for(var key in pojo)
            keys.push(key);
        keys.sort(); // TODO compare fn
        for(var i=0; i<keys.length; i++)
            this[keys[i]] && obj.push(this[keys[i]]);
        return obj;
    }
});


/** Host is (normally) a singleton object registering/coordinating
 *  all the local Swarm objects, connecting them to appropriate
 *  external uplinks, maintaining clocks, etc.
 *  Host itself is not fully synchronized like a Model but still
 *  does some event gossiping with peer Hosts.
 *  */
function Host (id) {
    this.objects= {};
    this.lastTs= '';
    this.tsSeq= 0;
    this.clockOffset= 0;
    this.peers= {};
    Syncable.call(this,id,undefined,this);
    delete this.objects[this.spec()];
}

Swarm.Host = Syncable.extend(Host,{
    deliver: function (spec,val,repl) {
        if (spec.type()!=='Host') {
            var typeid = spec.filter('/#');
            var obj = this.objects[typeid];
            if (!obj) {
                // TODO
            }
            obj && obj.deliver(spec,val,repl);
        } else
            this._super.deliver.apply(this,arguments);
    },
    __init: function (spec,val,repl) {
        this._storage = this._host;
        this._host = this; // :)
    },
    get: function (spec) {
        spec = new Spec(spec);
        var typeid = spec.filter('/#');
        if (typeid.pattern()!=='/#') throw new Error('invalid spec');
        var o = this.objects[typeid];
        if (!o) {
            var t = Syncable.types[spec.type()];
            o = new t(typeid,undefined,this);
        }
        return o;
    },
    // Host forwards on() calls to local objects to support some
    // shortcut notations, like 
    //          host.on('/Mouse',callback)
    //          host.on('/Mouse.init',callback)
    //          host.on('/Mouse#Mickey',callback)
    //          host.on('/Mouse#Mickey.init',callback)
    //          host.on('/Mouse#Mickey!baseVersion',repl)
    //          host.on('/Mouse#Mickey!base.x',trackfn)
    // The target object may not exist beforehand.
    __on: function (spec,evfilter,peer) {
        if (evfilter) {
            if (evfilter.constructor===Function && evfilter.id)
                evfilter = '/' + evfilter.id;
            if (!Spec.is(evfilter)) 
                throw new Error('signature not understood');
            var flt = new Spec(evfilter);
            // TODO maintain timestamp all the way down the callgraph
            var version = this.version();
            if (!flt.has('/'))
                throw new Error('no type mentioned');
            if (!flt.has('#'))
                flt.set('#',version);
            var typeid = flt.filter('/#');
            var o = this.get(typeid);
            o.on(typeid+'!'+version+'.on',flt.filter('!.'),peer);
            // We don't do this as the object may have no state now. 
            // return o;
            // Instead, use host.on('/Type#id.init', function(,,o) {})
            
        } else {  // Downlink/peer host subscription

            if (false) { // their time is off so tell them so
                this.clockOffset;
            }
            var old = this.peers[peer._id];
            old && old.off(peer._id,null,this);
            
            this.peers[peer._id] = peer;
            if (spec.method()==='on')
                peer.reon('/Host#'+peer._id+'!'+spec.version()+'.reon','',this);
            
            for(var sp in this.objects)
                this.objects[sp].checkUplink();

            this.__emit(spec,'',peer); // PEX hook
        }
    },
    __off: function (spec,nothing,peer) {
        if (spec.type()!=='Host') { // host.off('/Type#id') shortcut
            var typeid = spec.filter('/#');
            var obj = this.objects[typeid];
            return obj && obj.off(spec,clocks,peer);
        }
        if (this.peers[peer._id]!==peer)
            throw new Error('peer unknown');
        delete this.peers[peer._id];
        for(var sp in this.objects) {
            var obj = this.objects[sp];
            if (obj._lstn && obj._lstn.indexOf(peer)!==-1) {
                obj.off(sp,'',peer);
                this.checkUplink(sp);
            }
        }
        spec.method()==='off' && peer.reoff(this);
    },
    // Returns an unique Lamport timestamp on every invocation.
    // Swarm employs 30bit integer Unix-like timestamps starting epoch at
    // 1 Jan 2010. Timestamps are encoded as 5-char base64 tokens; in case
    // several events are generated by the same process at the same second
    // then sequence number is added so a timestamp may be more than 5
    // chars. The id of the Host (+user~session) is appended to the ts.
    version: function () {
        var d = new Date().getTime() - Host.EPOCH + (this.clockOffset||0);
        var ts = Spec.int2base((d/1000)|0,5), seq='';
        if (ts===this.lastTs)
            seq = Spec.int2base(++this.tsSeq,2); // max ~4000Hz
        else
            this.tsSeq = 0;
        this.lastTs = ts;
        return ts + seq + '+' + this._id;
    },
    // Returns an array of available uplink peer ids according to the consistent
    // hashing scheme. Note that client-side code runs this logic as well:
    // it is perfectly OK for a client to connect to multiple edge servers.
    availableUplinks: function (spec) {
        var target = Swarm.hash(spec), threshold = Swarm.hashDistance(this._id,target);
        var self=this, uplinks=[];
        for(var id in this.peers) {
            var dist = Swarm.hashDistance(id,target); //Math.abs(hash(id)-target);
            dist<=threshold && uplinks.push({id:id,distance:dist});
        }
        uplinks.sort(function(x,y){ return x.distance - y.distance });
        return uplinks.map(function(o){return self.peers[o.id]});
    },
    register: function (obj) {
        var spec = obj.spec();
        if (spec in this.objects)
            return this.objects[spec];
        this.objects[spec] = obj;
        return obj;
    },
    unregister: function (obj) {
        var spec = obj.spec();
        // TODO unsubscribe from the uplink - swarm-scale gc
        (spec in this.objects) && delete this.objects[spec];
    },
    checkUplink: function (spec) {
        //  TBD Host event relay + PEX
    },
    __reon: '__on',
    __reoff: '__off'
});
Host.MAX_INT = 9007199254740992;
Host.EPOCH = 1262275200000; // 1 Jan 2010 (milliseconds)
Host.MAX_SYNC_TIME = 60*60000; // 1 hour (milliseconds)
Swarm.HASH_FN = murmurhash3_32_gc; //TODO use 2-liner, add murmur in murmur.js
Swarm.CHASH_POINT_COUNT = 3;

Swarm.hash = function hash (str) {
    var ret = [];
    // TODO rolling cache
    for(var i=0; i<Swarm.CHASH_POINT_COUNT; i++)
        ret.push(Swarm.HASH_FN(str,i))
    return ret;
};


Swarm.hashDistance = function hashDistance (id1,id2) {
    var hash1 = id1.constructor===Array ? id1 : id1=Swarm.hash(id1.toString());
    var hash2 = id2.constructor===Array ? id2 : id2=Swarm.hash(id2.toString());
    var mindist = 4294967295;
    for(var i=0; i<Swarm.CHASH_POINT_COUNT; i++)
        for(var j=i; j<Swarm.CHASH_POINT_COUNT; j++)
            mindist = Math.min( mindist, Math.abs(hash1[i]-hash2[j]) );
    return mindist;
};

var STUB = {
    deliver:function(){},
    on:function(){},
    off:function(){}
};

