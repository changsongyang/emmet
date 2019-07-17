import { TokenGroup, TokenStatement, TokenElement, TokenAttribute, isQuote, isBracket } from './parser';
import { Abbreviation, ParserOptions, AbbreviationNode, ConvertState, TokenValue, AbbreviationAttribute, AttributeType } from './types';
import { Repeater, Value, Quote } from './tokenizer';
import stringify from './stringify';

/**
 * Converts given token-based abbreviation into simplified and unrolled node-based
 * abbreviation
 */
export default function convert(abbr: TokenGroup, options: ParserOptions = {}): Abbreviation {
    return {
        type: 'Abbreviation',
        children: convertGroup(abbr, {
            inserted: false,
            repeaters: [],
            text: options.text,
            getText(pos) {
                const value = Array.isArray(options.text)
                    ? (pos != null ? options.text[pos] : options.text.join('\n'))
                    : options.text;

                return value != null ? value : '';
            },
            getVariable(name) {
                const varValue = options.variables && options.variables[name];
                return varValue != null ? varValue : name;
            }
        })
    };
}

/**
 * Converts given statement to abbreviation nodes
 */
function convertStatement(node: TokenStatement, state: ConvertState): AbbreviationNode[] {
    let result: AbbreviationNode[] = [];

    if (node.repeat) {
        // Node is repeated: we should create copies of given node
        // and supply context token with actual repeater state
        const original = node.repeat;
        const repeat = { ...original } as Repeater;
        const count = repeat.implicit && Array.isArray(state.text)
            ? state.text.length
            : (repeat.count || 1);
        let items: AbbreviationNode | AbbreviationNode[];

        state.repeaters.push(repeat);

        for (let i = 0; i < count; i++) {
            repeat.value = i;
            node.repeat = repeat;
            items = isGroup(node)
                ? convertGroup(node, state)
                : convertElement(node, state);

            if (repeat.implicit && !state.inserted) {
                // It’s an implicit repeater but no repeater placeholders found inside,
                // we should insert text into deepest node
                const target = Array.isArray(items) ? last(items) : items;
                const deepest = target && deepestNode(target);
                if (deepest) {
                    insertText(deepest, state.getText(repeat.value));
                }
            }

            result = result.concat(items);
        }

        state.repeaters.pop();
        node.repeat = original;

        if (repeat.implicit) {
            state.inserted = true;
        }
    } else if (isGroup(node)) {
        result = result.concat(convertGroup(node, state));
    } else {
        result.push(convertElement(node, state));
    }

    return result;
}

function convertElement(node: TokenElement, state: ConvertState): AbbreviationNode {
    let children: AbbreviationNode[] = [];
    let attributes: AbbreviationAttribute[] | undefined;

    for (let i = 0; i < node.elements.length; i++) {
        children = children.concat(convertStatement(node.elements[i], state));
    }

    if (node.attributes) {
        attributes = [];
        for (let i = 0; i < node.attributes.length; i++) {
            attributes.push(convertAttribute(node.attributes[i], state));
        }
    }

    return {
        type: 'AbbreviationNode',
        name: node.name && stringifyName(node.name, state),
        value: node.value && stringifyValue(node.value, state),
        attributes,
        children,
        repeat: node.repeat,
        selfClosing: node.selfClose,
    };
}

function convertGroup(node: TokenGroup, state: ConvertState): AbbreviationNode[] {
    let result: AbbreviationNode[] = [];
    for (let i = 0; i < node.elements.length; i++) {
        result = result.concat(convertStatement(node.elements[i], state));
    }

    return result;
}

function convertAttribute(node: TokenAttribute, state: ConvertState): AbbreviationAttribute {
    let implied = false;
    let isBoolean = false;
    let valueType: AttributeType = 'raw';
    let value: TokenValue[] | undefined;
    const name = node.name && stringifyName(node.name, state);

    if (name && name[0] === '!') {
        implied = true;
    }

    if (name && name[name.length - 1] === '.') {
        isBoolean = true;
    }

    if (node.value) {
        const tokens = node.value.slice();

        if (isQuote(tokens[0])) {
            // It’s a quoted value: remove quotes from output but mark attribute
            // value as quoted
            const quote = tokens.shift() as Quote;
            if (tokens.length && last(tokens).type === quote.type) {
                tokens.pop();
            }
            valueType = quote.single ? 'singleQuote' : 'doubleQuote';
        } else if (isBracket(tokens[0], 'expression', true)) {
            // Value is expression: remove brackets but mark value type
            valueType = 'expression';
            tokens.shift();
            if (isBracket(last(tokens), 'expression', false)) {
                tokens.pop();
            }
        }

        value = stringifyValue(tokens, state);
    }

    return {
        name: isBoolean || implied
            ? name!.slice(implied ? 1 : 0, isBoolean ? -1 : void 0)
            : name,
        value,
        boolean: isBoolean,
        implied,
        valueType
    };
}

/**
 * Converts given token list to string
 */
function stringifyName(tokens: Value[], state: ConvertState): string {
    let str = '';
    for (let i = 0; i < tokens.length; i++) {
        str += stringify(tokens[i], state);
    }

    return str;
}

/**
 * Converts given token list to value list
 */
function stringifyValue(tokens: Value[], state: ConvertState): TokenValue[] {
    const result: TokenValue[] = [];
    let str = '';
    for (let i = 0, token: Value; i < tokens.length; i++) {
        token = tokens[i];
        if (token.type === 'Field' && token.index != null) {
            // We should keep original fields in output since some editors has their
            // own syntax for field or doesn’t support fields at all so we should
            // capture actual field location in output stream
            if (str) {
                result.push(str);
                str = '';
            }
            result.push(token);
        } else {
             str += stringify(token, state);
        }
    }

    if (str) {
        result.push(str);
    }

    return result;
}

export function isGroup(node: any): node is TokenGroup {
    return node.type === 'TokenGroup';
}

function last<T>(arr: T[]): T {
    return arr[arr.length - 1];
}

function deepestNode(node: AbbreviationNode): AbbreviationNode {
    return node.children.length ? deepestNode(last(node.children)) : node;
}

function insertText(node: AbbreviationNode, text: string) {
    if (node.value) {
        const lastToken = last(node.value);
        if (typeof lastToken === 'string') {
            node.value[node.value.length - 1] += text;
        } else {
            node.value.push(text);
        }
    } else {
        node.value = [text];
    }
}
