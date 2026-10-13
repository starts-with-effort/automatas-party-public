import { EXAMPLES } from './pda/examples.js';
import { runNotes, treeNotes } from './pda/narrate.js';

// Manifiesto de la presentación: orden, sección, quién expone, tiempo asignado (segundos), guion y
// una nota por paso. Lo usan el servidor (cuántos pasos hay), el proyector y el celular, así que no
// toca el DOM. El contenido de cada diapositiva está en slides/<id>.js.

export const PRESENTERS = ['Integrante 1', 'Integrante 2', 'Integrante 3', 'Integrante 4'];

export const SECTIONS = {
  intro: 'Introducción',
  def: '3.1 · Definición del PDA',
  lang: '3.2 · Lenguajes de un PDA',
  end: 'Cierre',
  quiz: 'El quiz',
  backup: 'Respaldo',
};

// Antepone una frase a la primera nota (la de la ID inicial de una ejecución).
const lead = (text, [first, ...rest]) => [`${text} ${first}`, ...rest];

// Cada diapositiva: id (slides/<id>.js), sección, quién expone (1–4; 0 en las de respaldo), tiempo
// en segundos, título, guion (qué contar y qué responder si preguntan) y una nota por paso: la
// primera es la del paso 0 (al llegar) y cada una de las siguientes, la de un toque de «Siguiente».
// Las de la sección «El quiz» van después del cierre y explican el juego: no son parte de la
// exposición, así que no tienen integrante ni tiempo asignado (presenter y budget en 0).
export const SLIDES = [
  {
    id: 'portada', section: 'intro', presenter: 1, budget: 30, title: 'Autómatas de pila',
    script: 'Saluden y presenten al equipo. Cuenten el plan de la sesión: unos 20 minutos de exposición, después el taller y al final el quiz en los celulares.',
    steps: [
      'Buenos días. Somos [nombres]. Hoy les presentamos los **autómatas de pila** (PDA, por pushdown automata): en 3.1, qué son y cómo se definen; en 3.2, qué lenguajes aceptan.',
      'El recorrido: los autómatas que ya conocemos y qué les falta, la idea de la pila, la definición formal, cómo se ejecuta un PDA paso a paso, el no determinismo y las dos formas de aceptar. Al final, taller y quiz.',
    ],
  },
  {
    id: 'finitos', section: 'intro', presenter: 1, budget: 60, title: 'Lo que ya conocemos',
    script: 'Es un repaso rápido, no una clase de autómatas finitos: recordar cómo se lee un diagrama y la diferencia entre seguir un camino (AFD) y varios a la vez (AFN), que vuelve con el PDA no determinista. Si preguntan: los dos reconocen el mismo lenguaje, y todo AFN tiene un AFD equivalente.',
    steps: [
      'Antes de lo nuevo, lo que ya conocemos: los **autómatas finitos**. Aquí hay dos para el mismo lenguaje, las cadenas que terminan en ab: uno determinista y uno no determinista. A los dos les damos la misma cadena: aab.',
      'El **determinista** (AFD): en cada estado hay exactamente una transición por símbolo. Lee a y pasa a q₁; lee otra a y se queda en q₁; lee b y llega a q₂, que es de aceptación. Sigue un solo camino.',
      'El **no determinista** (AFN): en q₀, con una a, puede quedarse o pasar a q₁. Sigue todas las opciones a la vez: después de aab están activos q₀ y q₂. Acepta porque **algún** camino terminó en un estado de aceptación.',
      'Fíjense en lo que tienen en común: lo único que recuerdan es **en qué estado están**. Con eso en mente, veamos qué les falta.',
    ],
  },
  {
    id: 'motivacion', section: 'intro', presenter: 1, budget: 60, title: '¿Qué le falta a un autómata finito?',
    script: 'Objetivo: que se sienta la necesidad de una memoria. El lema de bombeo solo se menciona, no se demuestra. Si preguntan: aⁿbⁿ no es regular; se prueba con el lema de bombeo para lenguajes regulares.',
    steps: [
      'Miren ahora este lenguaje: n letras a seguidas de exactamente n letras b. ab, aabb, aaabbb… ¿Lo puede reconocer un autómata finito?',
      'Para saber cuántas b esperar, tendría que recordar cuántas a leyó. En un AF la única memoria son los estados: uno para «leí 0 a», otro para «leí 1 a», otro para 2…',
      'Pero n no tiene límite: harían falta infinitos estados. Un AF tiene memoria **finita**, y aⁿbⁿ no es regular (se demuestra con el lema de bombeo).',
      'La solución: darle una memoria ilimitada pero muy simple, una **pila**. Es la misma idea que usa un compilador para revisar paréntesis, un navegador para las etiquetas anidadas o un programa para las llamadas recursivas.',
    ],
  },
  {
    id: 'idea', section: 'def', presenter: 1, budget: 75, title: 'La idea: un AFN-ε con una pila',
    script: 'Primero la intuición, sin estados ni símbolos formales: la pila lleva la cuenta de las a. La ficha oscura del fondo es Z₀, todavía sin nombre: lo recibe en la diapositiva siguiente. Si preguntan para qué sirve: el autómata siempre mira el tope, y esa ficha le deja saber que ya no quedan A.',
    steps: [
      'La idea es agregarle al autómata una **pila**: una memoria sin límite en la que solo se usa el **tope**. Lo último que entra es lo primero que sale, como en una pila de platos. Por ahora solo tiene la ficha que marca el fondo; todavía no le ponemos nombre.',
      'Probemos con la cadena aabb, todavía sin estados ni transiciones. La regla: por cada a entra una A a la pila; por cada b sale una A.',
      'Lee la primera a: entra una A.',
      'Lee la segunda a: entra otra A. La pila lleva la cuenta de las a.',
      'Lee la primera b: sale una A.',
      'Lee la segunda b: sale la otra A. Se acabó la cadena y en la pila **solo queda el fondo**: hubo tantas b como a. La cadena es válida.',
      'Ahora con una a de más: aaabb. Entran tres A y salen solo dos: al final **sobra una A** en la pila, así que esta cadena no es válida.',
      'Eso es un autómata de pila: el autómata finito que ya conocemos (un AFN-ε, con sus estados y transiciones) más una pila. Ahora vamos afinando la idea: cómo se escriben sus transiciones y, después, la definición formal.',
    ],
  },
  {
    id: 'transicion', section: 'def', presenter: 1, budget: 75, title: 'Anatomía de una transición',
    script: 'Expliquen la etiqueta a, X / α parte por parte. La convención clave: el primer símbolo de α queda en el tope. Si preguntan si se puede leer sin tocar la pila: sí, con X / X (se saca X y se vuelve a poner).',
    steps: [
      'Así se escribe una transición: **a, X / α**. Se lee: «si leo a y en el tope hay X, cambio X por α».',
      'a es el símbolo que se lee (o ε si no lee nada). X es lo que tiene que estar en el tope: se saca. α es la cadena que se pone en su lugar, y su primer símbolo queda arriba. Formalmente: (p, α) ∈ δ(q, a, X).',
      '**Sacar**: con α = ε. Por ejemplo, b, A / ε saca la A del tope. Debajo queda Z₀: es la ficha del fondo que vimos antes, ahora con su nombre.',
      '**Dejar igual**: si α = X, la pila no cambia. Por ejemplo, ε, Z₀ / Z₀ solo cambia de estado.',
      '**Apilar**: a, A / AA saca la A y pone AA; en la práctica, agrega una A arriba. Para apilar Y sobre X se escribe X / YX.',
    ],
  },
  {
    id: 'definicion', section: 'def', presenter: 1, budget: 90, title: 'Definición formal',
    script: 'Relacionen cada componente con el PDA de aⁿbⁿ de la derecha (es el que se arma en la diapositiva siguiente). Si preguntan por qué δ devuelve subconjuntos finitos: así caben el no determinismo y el caso sin movimiento (∅).',
    steps: [
      'Formalmente, un PDA es una 7-tupla: P = (Q, Σ, Γ, δ, q₀, Z₀, F). Vamos componente por componente con el ejemplo de aⁿbⁿ.',
      'Q es el conjunto finito de estados: q₀, q₁, q₂. Σ es el alfabeto de entrada, {a, b}. Γ es el alfabeto de la pila, {A, Z₀}: puede ser distinto de Σ.',
      'δ es la función de transición: recibe un estado, un símbolo de entrada o ε y el símbolo del tope, y devuelve un **conjunto finito** de pares (estado, cadena para la pila). Por ejemplo, δ(q₀, a, Z₀) = {(q₀, AZ₀)}: es el arco que está resaltado.',
      'q₀ es el estado inicial; Z₀, el símbolo inicial de la pila (lo único que hay al empezar); y F, los estados de aceptación: aquí F = {q₂}.',
      'Ojo: δ devuelve un conjunto, así que puede haber varias opciones (no determinismo) o ninguna (∅): en ese caso esa computación se detiene.',
    ],
  },
  {
    id: 'notacion', section: 'def', presenter: 2, budget: 60, title: 'Notación gráfica',
    script: 'El diagrama es como el de un AF, pero cada arco lleva a, X / α. Cuenten la historia del PDA: apila las a, desapila con las b y acepta cuando reaparece Z₀.',
    steps: [
      'La notación gráfica es la de los autómatas finitos: estados, flecha de inicio y doble círculo para los de aceptación. Lo nuevo son las etiquetas: un arco de q a p con a, X / α significa (p, α) ∈ δ(q, a, X).',
      'En q₀ se leen las a: con Z₀ o con A en el tope, apila una A. Así la pila cuenta cuántas a hubo.',
      'La primera b saca una A y pasa a q₁: desde aquí ya no se aceptan más a.',
      'En q₁, cada b saca una A.',
      'Cuando vuelve a aparecer Z₀ en el tope ya no quedan A: sin leer (ε) pasa a q₂, que es de aceptación.',
    ],
  },
  {
    id: 'descripciones', section: 'def', presenter: 2, budget: 75, title: 'Descripciones instantáneas',
    script: 'La descripción instantánea (ID) es la «foto» del PDA en un momento. Primero léanla en palabras y después muestren cómo se escribe. ⊢ se lee «pasa en un movimiento a» y ⊢*, «llega en cero o más movimientos a» (es la clausura reflexiva y transitiva de ⊢). La pila se escribe con el tope a la izquierda.',
    steps: [
      'Para seguir una ejecución necesitamos una «foto» del autómata en un instante: una **descripción instantánea**. Guarda tres datos. En este ejemplo: está en q₀, le falta leer abb y en la pila hay una A encima de Z₀. La pila se escribe con el tope a la izquierda.',
      'En general se escribe (q, w, γ): q es el estado actual, w lo que falta por leer y γ el contenido de la pila.',
      'Un **movimiento** lleva de una foto a la siguiente. Al empezar con aabb, la foto es (q₀, aabb, Z₀). Lee la a y cambia el tope Z₀ por AZ₀: queda en (q₀, abb, AZ₀).',
      'Eso se escribe con el símbolo ⊢ entre las dos fotos. Se lee «pasa en un movimiento a»: (q₀, aabb, Z₀) pasa en un movimiento a (q₀, abb, AZ₀).',
      'Para varios movimientos seguidos se le agrega un asterisco: ⊢* se lee «llega en cero o más movimientos a». Desde (q₀, aabb, Z₀) se llega a (q₂, ε, Z₀); la ε del medio dice que ya no falta nada por leer.',
      'La regla general: si (p, α) ∈ δ(q, a, X), entonces (q, aw, Xβ) ⊢ (p, w, αβ). Se lee a, el tope X se cambia por α, y lo demás, el resto de la entrada (w) y de la pila (β), no se toca.',
    ],
  },
  {
    id: 'simulacion', section: 'def', presenter: 2, budget: 90, title: 'Simulación paso a paso: aabb',
    script: 'Un movimiento por toque. En cada uno señalen las tres cosas que cambian: el arco que se usa, la cinta y la pila; y lean la ID nueva de la derecha. El veredicto llega al final.',
    steps: lead('Juntemos todo: ejecutamos aabb en el PDA de aⁿbⁿ.', runNotes(EXAMPLES.anbn, 'aabb', 'final')),
  },
  {
    id: 'rechazo', section: 'def', presenter: 2, budget: 60, title: 'Cuando no se acepta',
    script: 'Dos formas de fallar: terminar la entrada en un estado no final, o atascarse con entrada sin leer. abb es la trampa: llega a q₂, pero no cuenta porque le sobra una b.',
    steps: [
      '¿Qué pasa con cadenas que no están en el lenguaje? Probemos aab y abb en el mismo PDA.',
      'aab: lee las tres letras y queda en (q₁, ε, AZ₀). Sobra una A, no hay transición para seguir y q₁ no es final: **rechazada**.',
      'abb: después de ab queda Z₀ en el tope y, con ε, pasa a q₂… pero todavía falta leer una b, y desde q₂ no hay transiciones: **rechazada**. Llegar a un estado final no basta.',
      'La regla: se acepta solo si se lee **toda** la entrada y se termina en un estado final. Cuando no hay transición posible, esa computación muere.',
    ],
  },
  {
    id: 'mitades', section: 'def', presenter: 3, budget: 45, title: 'wwᴿ: apilar una mitad y compararla',
    script: 'Antes del diagrama y del árbol, la estrategia en palabras: apilar la primera mitad y, con la segunda, ir sacando y comparando. La pila invierte el orden; por eso sirve para wwᴿ. Cierren con la pregunta de dónde está la mitad: la respuesta (adivinarla) es la diapositiva siguiente.',
    steps: [
      'Ahora un lenguaje más difícil: wwᴿ, una cadena seguida de ella misma al revés, como 0110: primero 01 y luego 10. Son los palíndromos de largo par. ¿Cómo comprobamos que la segunda mitad es la primera al revés? Con la pila.',
      'La primera mitad se **apila**: lee 0 y lo guarda; lee 1 y lo guarda encima.',
      'Con la segunda mitad se va **sacando**: cada símbolo que se lee tiene que ser igual al tope. Lee 1 y en el tope hay un 1: lo saca. Lee 0 y en el tope hay un 0: lo saca.',
      'Como la pila devuelve primero lo último que entró, entrega la primera mitad al revés: justo lo que había que comparar. Si todo coincide y solo queda Z₀, la cadena está en el lenguaje. Queda un problema: ¿cómo sabe el autómata dónde termina la primera mitad?',
    ],
  },
  {
    id: 'wwr', section: 'def', presenter: 3, budget: 45, title: 'Un PDA no determinista: wwᴿ',
    script: 'Es el ejemplo 6.2 del libro de Hopcroft. El punto: el PDA no puede saber dónde está la mitad, así que la adivina con transiciones ε. Si preguntan si hay un PDA determinista para wwᴿ: no, pero eso es del grupo siguiente (3.3).',
    steps: [
      'Este es el PDA que lo hace. Tiene que apilar la primera mitad y compararla con la segunda… pero mientras lee no puede saber dónde está la mitad.',
      'En q₀, el PDA apila todo lo que lee, sea 0 o 1, sobre cualquier tope.',
      'En cualquier momento puede **adivinar** que llegó a la mitad: con ε pasa a q₁ sin leer y sin tocar la pila. Con 0 en el tope, por ejemplo, tiene dos opciones: seguir apilando o pasar a q₁. Eso es no determinismo.',
      'En q₁ compara: si lo que lee coincide con el tope, lo saca. Si reaparece Z₀, pasa a q₂ y acepta.',
    ],
  },
  {
    id: 'arbol', section: 'def', presenter: 3, budget: 90, title: 'Árbol de computación: 0110',
    script: 'Un nivel por toque; señalen por qué muere cada rama. El mensaje final: con no determinismo, una cadena se acepta si **alguna** computación acepta. El libro hace lo mismo con 1111 (figura 6.5).',
    steps: treeNotes(EXAMPLES.wwr, '0110', 'final'),
  },
  {
    id: 'aceptacion', section: 'lang', presenter: 3, budget: 105, title: 'Dos formas de aceptar',
    script: 'Aquí empieza 3.2. Partan del autómata que ya conocen y de cómo acepta (por estado final); después presenten la pila vacía y muéstrenla en ese mismo autómata. Los símbolos van al final: los colores unen cada frase con su parte de la fórmula (rosado, «se leyó todo»; amarillo, la condición). Si preguntan: con el autómata original, L(P) = {aⁿbⁿ | n ≥ 1} y N(P) = ∅, porque nunca saca Z₀. Y sí, siempre se puede pasar de una forma a la otra: son los dos teoremas que vienen.',
    steps: [
      'Volvamos al autómata de aⁿbⁿ. Hasta ahora aceptamos así, **por estado final**: se lee toda la cadena y se termina en un estado de aceptación. Con aabb termina en q₂. En la pila quedó Z₀, pero eso no importa.',
      'Hay otra forma de aceptar, **por pila vacía**: se lee toda la cadena y la pila queda vacía. Aquí lo que no importa es el estado.',
      '¿Cómo se ve en este autómata? Al terminar aabb, en la pila queda Z₀: no está vacía. De hecho este autómata nunca saca Z₀, así que por pila vacía no acepta nada.',
      'Para que acepte por pila vacía basta agregarle una transición: en q₂, sin leer nada, saca Z₀. Ahora, al terminar aabb, la pila queda vacía.',
      'Y con símbolos: L(P) es el lenguaje que P acepta por estado final, y N(P), el que acepta por pila vacía. Se leen como las frases de arriba: desde el inicio se llega, en varios movimientos, a no tener nada por leer (la ε rosada) y, en un caso, con q en F; en el otro, con la pila vacía (la ε amarilla). Ahora veamos un autómata pensado desde el principio para pila vacía.',
    ],
  },
  {
    id: 'pila-vacia', section: 'lang', presenter: 3, budget: 75, title: 'Pila vacía en acción',
    script: 'Ejemplo pensado para pila vacía: un solo estado y F vacío. Ojo: con Z₀ en el tope tiene dos opciones (leer «(» o vaciar con ε), así que es no determinista, como wwᴿ; la ejecución muestra la rama que acepta. Si preguntan por qué no hay un PDA determinista que lo haga por pila vacía: es del grupo siguiente (3.3).',
    steps: lead('Un ejemplo pensado para pila vacía: paréntesis balanceados con **un solo estado**. Apila una P por cada «(», saca una por cada «)» y, con Z₀ en el tope, puede vaciar la pila.', runNotes(EXAMPLES.parens, '(())', 'empty')),
  },
  {
    id: 'teorema-pn-pf', section: 'lang', presenter: 4, budget: 105, title: 'De pila vacía a estado final',
    script: 'Es el teorema 6.9 de Hopcroft. La clave es el marcador X₀: P_N no puede «ver» que su pila quedó vacía, pero sí puede ver X₀ en el tope. Si preguntan por qué desde todos los estados: P_N puede vaciar su pila en cualquiera de ellos.',
    steps: [
      '¿Siempre se puede pasar de una forma de aceptar a la otra? Sí. **Primer teorema:** si un autómata de pila acepta un lenguaje por pila vacía, existe otro que acepta el mismo lenguaje por estado final. Lo construimos a partir del original; aquí, el de paréntesis (en el dibujo, la caja P_N).',
      'Primero se agrega un estado inicial nuevo, p₀. Sin leer nada, deja una marca nueva, X₀, en el fondo de la pila, pone Z₀ encima y entra al autómata original.',
      'Luego, un estado de aceptación nuevo, p_f. Desde **cada** estado del original, si aparece X₀ en el tope es porque el original habría vaciado su pila: sin leer nada, pasa a p_f y acepta.',
      ...lead('Probémoslo con ().', runNotes(EXAMPLES.parensFinal, '()', 'final')),
    ],
  },
  {
    id: 'teorema-pf-pn', section: 'lang', presenter: 4, budget: 105, title: 'De estado final a pila vacía',
    script: 'Es el teorema 6.11 de Hopcroft. Ahora al revés: desde cada estado final se pasa a un estado que vacía la pila. X₀ evita aceptar de más (la diapositiva de respaldo R2 muestra un ejemplo).',
    steps: [
      '**Segundo teorema**, al revés: si un autómata de pila acepta un lenguaje por estado final, existe otro que acepta el mismo lenguaje por pila vacía. Ahora partimos del autómata de aⁿbⁿ (la caja P_F).',
      'Igual que antes: un estado inicial nuevo, p₀, que deja la marca X₀ en el fondo y pone Z₀ encima.',
      'Y un estado nuevo, p, que vacía la pila: desde cada estado de aceptación del original se pasa a p sin leer nada, sacando el símbolo del tope, sea cual sea (por eso la Y); en p se sigue sacando hasta vaciarla.',
      '¿Para qué sirve X₀ aquí? El autómata original podría vaciar su pila sin estar en un estado de aceptación, y el nuevo aceptaría cadenas de más. Con X₀ en el fondo, la pila solo queda vacía pasando por p.',
      ...lead('Probémoslo con ab.', runNotes(EXAMPLES.anbnStack, 'ab', 'empty')),
    ],
  },
  {
    id: 'equivalencia', section: 'lang', presenter: 4, budget: 60, title: 'Mismo poder',
    script: 'Cierren 3.2: las dos formas de aceptar definen la misma clase de lenguajes. No entren en PDA deterministas ni en gramáticas: es del grupo siguiente; solo anúncienlo.',
    steps: [
      'Tenemos dos familias de lenguajes: los que algún PDA acepta por estado final y los que algún PDA acepta por pila vacía. Los dos teoremas pasan de una a la otra.',
      'Como cada construcción conserva el lenguaje, son **la misma clase**: los lenguajes aceptados por un PDA.',
      'Frente a un autómata finito: la memoria pasa de solo estados a estados más una pila, las transiciones también miran el tope y se puede aceptar de dos maneras equivalentes. Con eso se reconocen aⁿbⁿ, wwᴿ o los paréntesis balanceados.',
      'Lo que sigue lo presenta el próximo grupo (3.3 y 3.4): los PDA deterministas y la relación entre los PDA y las gramáticas libres de contexto.',
    ],
  },
  {
    id: 'cierre', section: 'end', presenter: 4, budget: 45, title: 'Cierre',
    script: 'Resuman en tres ideas y abran preguntas. El último paso muestra el QR del quiz: úsenlo solo si el quiz va enseguida; si no, quédense en «¿Preguntas?». Las de respaldo están en el menú del celular. Después del cierre siguen las diapositivas que explican el quiz (sección «El quiz»).',
    steps: [
      'Para cerrar, tres ideas: un PDA es un AFN-ε con una pila; su ejecución se sigue con descripciones instantáneas y, con no determinismo, basta una rama que acepte; y aceptar por estado final o por pila vacía da el mismo poder.',
      '¿Preguntas? En el menú (☰) están las de respaldo: simulador en vivo, qué falla sin X₀, propiedades de las ID y qué no puede hacer un PDA.',
      'Ahora, el taller y el quiz: escaneen el código con el celular para entrar.',
    ],
  },
  {
    id: 'quiz-rondas', section: 'quiz', presenter: 0, budget: 0, title: 'El quiz: 6 rondas',
    script: 'Desde aquí ya no es la exposición: son las reglas del quiz, para contarlas justo antes de empezarlo (sin tiempo asignado; las puede contar cualquiera del equipo). En esta, solo la estructura. Si preguntan cuánto dura: unos 40 minutos.',
    steps: [
      'Ahora, el quiz. Son **6 rondas**. El avance se ve como un autómata, en el celular y en el proyector: cada ronda es un estado, de q₁ a q_F.',
      'Las primeras 5 rondas tienen siempre las mismas partes: una pregunta, eligen un objeto, otra pregunta, un minijuego y, al final, usan el objeto.',
      'La ronda 6 es una sola pregunta, la final. En total son **11 preguntas**; después sale el ranking final.',
    ],
  },
  {
    id: 'quiz-preguntas', section: 'quiz', presenter: 0, budget: 0, title: 'Las preguntas: dos celulares',
    script: 'El punto: nadie tiene toda la información, así que el equipo tiene que hablar. Primero aparece la pregunta y unos segundos después se habilitan las opciones; el tiempo depende de la dificultad (30, 45 o 60 segundos). Si a un equipo se le cae un celular, el otro ve la pregunta y las opciones.',
    steps: [
      'Cada equipo juega con **dos celulares**, y en las preguntas no ven lo mismo.',
      'Un celular tiene **la pregunta**… y nada más: no ve las opciones.',
      'El otro tiene **las respuestas**, sin la pregunta. Así que hablen: uno lee la pregunta en voz alta y el otro, las opciones.',
      'Hay **una sola respuesta** por equipo y la primera que toquen queda: pónganse de acuerdo antes de tocar. En la pregunta siguiente cambian de papel.',
      'Responder más rápido da más puntos. Y varios aciertos seguidos arman una **racha**, que multiplica los puntos; si fallan, la racha se pierde.',
    ],
  },
  {
    id: 'quiz-objetos', section: 'quiz', presenter: 0, budget: 0, title: 'Los objetos',
    script: 'No hace falta leerlos todos: nombren uno o dos de cada grupo; en el celular cada objeto trae su explicación. Se eligen entre la primera y la segunda pregunta de la ronda (20 segundos) y se usan después del minijuego, todos los equipos a la vez y en secreto. Si no usan un objeto, lo conservan. El Desafío queda aparte: se explica con el duelo.',
    steps: [
      'En cada ronda, cada equipo **elige 1 objeto entre 3** y lo puede usar después del minijuego. Arriba están todos: 16, en tres grupos, y uno especial.',
      'Los que van **contra otro equipo**: le quitan puntos, tiempo o racha, o le llenan la pantalla de tinta. Unos son ataques físicos y otros, hechizos.',
      'Las **defensas**: un escudo para los ataques físicos, otro para los hechizos y el Espejo, que los devuelve. Son raras de encontrar.',
      'Los que son **para tu equipo**: una segunda oportunidad, más racha o puntos. Ojo con Doble o nada: también se puede perder.',
      'Y uno especial, el **Desafío**: ningún escudo lo detiene. Lo explicamos en un momento, con el duelo.',
    ],
  },
  {
    id: 'quiz-formatos', section: 'quiz', presenter: 0, budget: 0, title: 'Los minijuegos: tres formatos',
    script: 'No expliquen cada minijuego: las instrucciones salen en pantalla antes de cada uno, con una demostración. El tercer formato es el del jefe (la Arena): no lo revelen, es la sorpresa de la última ronda.',
    steps: [
      'En cada una de las 5 rondas hay un minijuego distinto. Las instrucciones salen en pantalla antes de empezar. Lo que cambia es con quién juegan: hay tres formatos.',
      '**Individual**: cada equipo juega por su cuenta, con sus dos celulares.',
      '**En grupos**: se juntan dos equipos y se ayudan. Lo que consigan es de los dos.',
      'Y un tercer formato… que no les vamos a contar. Ya lo verán.',
      'Ganar un minijuego da puntos y algo más: un **fragmento de estrella**.',
    ],
  },
  {
    id: 'quiz-estrellas', section: 'quiz', presenter: 0, budget: 0, title: 'Las estrellas',
    script: 'Los puntos de fragmentos y estrellas van en un pozo aparte del puntaje del juego; el ranking suma los dos. En toda la partida se reparten unos 7 fragmentos: sin quitarle fragmentos a otro equipo es casi imposible completar una estrella. Para comparar: una pregunta vale 1000, 1500 o 2000 puntos de base.',
    steps: [
      'Quien gana un minijuego recibe un **fragmento**: una punta de la estrella.',
      'Cada fragmento ya vale **1000 puntos**.',
      'Con 5 fragmentos se completa la **estrella**, que vale 6000 puntos: bastante más que una pregunta.',
      'Pero hay pocos fragmentos en toda la partida, y las estrellas **se pueden robar**. ¿Cómo? Con el Desafío.',
    ],
  },
  {
    id: 'quiz-duelo', section: 'quiz', presenter: 0, budget: 0, title: 'El Desafío y el duelo',
    script: 'El Desafío no sale de la misma bolsa que los demás objetos: en cada reparto le aparece a uno o dos equipos, primero a los que no tienen fragmentos. Si el equipo retado no tiene nada que robar, el duelo no se juega. En cada mano elige un solo celular por equipo y se van turnando; si no eligen a tiempo, sale una opción al azar.',
    steps: [
      'El **Desafío** es el objeto especial: con él retan a otro equipo a un **duelo**. Nada lo bloquea: ni los escudos ni el Espejo.',
      'El duelo es **piedra, papel o tijera**. En cada mano elige un solo celular por equipo; si empatan, se juega otra mano.',
      'Si **gana** el que retó, se lleva **todas** las estrellas y los fragmentos del otro equipo, con sus puntos.',
      'Si **pierde**, no pasa nada: nadie pierde nada. Retar no tiene riesgo.',
      'También hay duelo cuando un minijuego termina en empate: decide quién se lleva el premio.',
    ],
  },
  {
    id: 'quiz-aviso', section: 'quiz', presenter: 0, budget: 0, title: 'Antes de empezar: es un juego',
    script: 'Díganlo con humor, pero díganlo: el juego está hecho para que nadie se escape en el marcador. La nota sale solo de las respuestas correctas (5 con todas bien), igual para todo el equipo; el puesto, los objetos, los minijuegos y las estrellas no cuentan.',
    steps: [
      'Una advertencia antes de empezar: el marcador va a dar **muchas vueltas**. Está hecho así a propósito, para que sea difícil acumular ventaja.',
      'Al que va primero todos le apuntan; un objeto o un duelo puede cambiarlo todo en un momento; y el que va atrás recibe ayuda. Si los tumban del primer puesto, no es personal: es el juego.',
      'Lo que sí cuenta para la nota es **responder bien las preguntas**. Así que tómenlo como un juego: ríanse de los vuelcos y respondan con calma. ¡A jugar!',
    ],
  },
  {
    id: 'simulador', section: 'backup', presenter: 0, budget: 0, title: 'Simulador en vivo', backup: true, live: true,
    script: 'Para responder «¿y qué pasa con…?». Elijan el PDA, escriban la cadena con las teclas y toquen «Ejecutar en el proyector»; luego avancen con «Siguiente». wwᴿ se muestra como árbol de computación (hasta 6 símbolos).',
    steps: [],
  },
  {
    id: 'sin-x0', section: 'backup', presenter: 0, budget: 0, title: '¿Qué falla sin X₀?', backup: true,
    script: 'Para la pregunta «¿para qué sirve X₀ en la construcción de estado final a pila vacía?».',
    steps: [
      'Tomemos un P_F con una «fuga»: δ(q₀, b, Z₀) = {(q₀, ε)}. Con la entrada b vacía la pila y queda en q₀, que no es final: b **no** está en L(P_F).',
      'Sin X₀ (solo agregando el estado que vacía la pila): con b la pila queda vacía y se leyó todo, así que b quedaría aceptada por pila vacía. ¡Acepta de más!',
      'Con X₀: después de leer b queda X₀ en la pila y no hay forma de sacarlo sin pasar por un estado final, así que b se rechaza, como debe ser.',
      'Por eso X₀: la pila del nuevo PDA solo se vacía en p, y a p solo se llega desde un estado final.',
    ],
  },
  {
    id: 'propiedades', section: 'backup', presenter: 0, budget: 0, title: 'Lo que no se ve no importa', backup: true,
    script: 'Por si preguntan cómo se razona con las descripciones instantáneas. Son los teoremas 6.5 y 6.6 de Hopcroft.',
    steps: [
      'Si (q, x, α) ⊢* (p, y, β), entonces (q, xw, αγ) ⊢* (p, yw, βγ). Agregar entrada al final (w) o símbolos debajo de la pila (γ) no cambia nada: el PDA nunca los mira.',
      'Y al revés, para la entrada: si (q, xw, α) ⊢* (p, yw, β), entonces (q, x, α) ⊢* (p, y, β). La entrada que no se leyó se puede quitar.',
      'Con la pila no vale lo mismo: el PDA podría sacar símbolos de abajo y volver a ponerlos, así que no se pueden quitar sin más.',
    ],
  },
  {
    id: 'limites', section: 'backup', presenter: 0, budget: 0, title: '¿Qué no puede hacer un PDA?', backup: true,
    script: 'Solo un adelanto: la demostración usa el lema de bombeo para lenguajes libres de contexto, que es otro tema.',
    steps: [
      '¿Hay lenguajes que ningún PDA acepta? Sí. Por ejemplo, aⁿbⁿcⁿ: misma cantidad de a, de b y de c.',
      'Con las a llenamos la pila, como antes.',
      'Con las b la vaciamos para comparar.',
      'Y para las c… ya no queda nada con qué comparar: la información se gastó.',
      'Con una sola pila no alcanza. Que **ningún** PDA lo acepta se demuestra con el lema de bombeo para lenguajes libres de contexto.',
    ],
  },
];

// Tiempo objetivo: la suma de las diapositivas principales.
export const TOTAL_BUDGET = SLIDES.filter((s) => !s.backup).reduce((sum, s) => sum + s.budget, 0);

// PDA del simulador en vivo: alfabeto (teclas del celular), largo máximo, cadena inicial, modo de
// aceptación y vista (ejecución o árbol de computación).
export const LIVE_OPTIONS = {
  anbn: { label: 'aⁿbⁿ', alphabet: ['a', 'b'], max: 10, input: 'aabb', mode: 'final', view: 'run' },
  parens: { label: 'Paréntesis', alphabet: ['(', ')'], max: 10, input: '(())', mode: 'empty', view: 'run' },
  wwr: { label: 'wwᴿ', alphabet: ['0', '1'], max: 6, input: '0110', mode: 'final', view: 'tree' },
};
export const DEFAULT_LIVE = { pda: 'anbn', input: LIVE_OPTIONS.anbn.input };

// Nota de cada paso. En el simulador en vivo dependen de la cadena.
export function stepNotes(slide, live) {
  return slide.live ? liveNotes(live ?? DEFAULT_LIVE) : slide.steps;
}

const liveCache = new Map();
function liveNotes({ pda, input }) {
  const key = `${pda}:${input}`;
  if (!liveCache.has(key)) {
    const option = LIVE_OPTIONS[pda];
    const notes = option.view === 'tree'
      ? treeNotes(EXAMPLES[pda], input, option.mode)
      : runNotes(EXAMPLES[pda], input, option.mode);
    if (liveCache.size > 200) liveCache.clear();
    liveCache.set(key, notes);
  }
  return liveCache.get(key);
}

export function stepCount(slide, live) {
  return stepNotes(slide, live).length;
}

// Cadena del simulador en vivo, validada (la usa también el servidor). null si no es válida.
export function normalizeLive(raw) {
  const option = LIVE_OPTIONS[raw?.pda];
  if (!option || !Object.hasOwn(LIVE_OPTIONS, raw.pda) || typeof raw.input !== 'string') return null;
  const symbols = [...raw.input];
  if (symbols.length > option.max || !symbols.every((c) => option.alphabet.includes(c))) return null;
  return { pda: raw.pda, input: raw.input };
}
